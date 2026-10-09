import type { StudentAttendanceStatus } from '@prisma/client'
import { formatUruguayHhMm } from '../../config/app-timezone.js'

export type RollCallBlockReason = 'LOCKED' | 'WINDOW_EXPIRED' | 'NOT_ASSIGNED' | 'NOT_STARTED'

/**
 * La lista se abre unos minutos antes de la clase, para el docente que entra temprano. Antes no
 * se puede pasar: nadie sabe todavía quién vino a una clase que no empezó.
 */
export const ROLL_CALL_OPENS_BEFORE_MINUTES = 10

/** Instante desde el que se puede pasar la lista de la ocurrencia. */
export function computeOpensAt(occurrenceStartAt: Date): Date {
  return new Date(occurrenceStartAt.getTime() - ROLL_CALL_OPENS_BEFORE_MINUTES * 60_000)
}

/**
 * Instante hasta el que el docente puede editar la planilla.
 *
 * El ancla es `max(endAt, takenAt)`: un docente que pasa lista tres días tarde igual
 * dispone de su ventana completa. El valor se CALCULA en cada lectura (no se congela al
 * guardar), así que bajar la ventana de 48 h a 24 h aplica retroactivamente.
 */
export function computeEditableUntil(params: {
  occurrenceEndAt: Date
  takenAt: Date | null
  windowHours: number
}): Date {
  const anchor = Math.max(params.occurrenceEndAt.getTime(), params.takenAt?.getTime() ?? 0)
  return new Date(anchor + params.windowHours * 3_600_000)
}

/** `editableUntil` es inclusivo: justo en el borde todavía se puede editar. */
export function isWithinEditWindow(editableUntil: Date, lockedAt: Date | null, now = new Date()): boolean {
  if (lockedAt && lockedAt.getTime() <= now.getTime()) return false
  return now.getTime() <= editableUntil.getTime()
}

export type RollCallPermissions = {
  canEdit: boolean
  /** Desde cuándo se puede pasar la lista (`ROLL_CALL_OPENS_BEFORE_MINUTES` antes del inicio). */
  opensAt: Date
  editableUntil: Date
  blockedReason: RollCallBlockReason | null
}

/**
 * Resuelve si quien pide puede escribir la planilla.
 *
 * Administración (`scope === 'all'`) nunca queda bloqueada por la ventana; sus escrituras
 * fuera de plazo se auditan con `outsideWindow: true` en vez de rechazarse. Lo que no puede nadie
 * es pasar la lista de una clase que todavía no abrió.
 */
export function resolveRollCallPermissions(params: {
  scope: 'own' | 'all'
  isAssignedTeacher: boolean
  occurrenceStartAt: Date
  occurrenceEndAt: Date
  takenAt: Date | null
  lockedAt: Date | null
  windowHours: number
  now?: Date
}): RollCallPermissions {
  const now = params.now ?? new Date()
  const opensAt = computeOpensAt(params.occurrenceStartAt)
  const editableUntil = computeEditableUntil({
    occurrenceEndAt: params.occurrenceEndAt,
    takenAt: params.takenAt,
    windowHours: params.windowHours,
  })
  const blocked = (blockedReason: RollCallBlockReason): RollCallPermissions => ({
    canEdit: false,
    opensAt,
    editableUntil,
    blockedReason,
  })
  const notStarted = now.getTime() < opensAt.getTime()

  if (params.scope === 'all') {
    return notStarted ? blocked('NOT_STARTED') : { canEdit: true, opensAt, editableUntil, blockedReason: null }
  }
  if (!params.isAssignedTeacher) return blocked('NOT_ASSIGNED')
  if (params.lockedAt && params.lockedAt.getTime() <= now.getTime()) return blocked('LOCKED')
  if (notStarted) return blocked('NOT_STARTED')
  if (!isWithinEditWindow(editableUntil, null, now)) return blocked('WINDOW_EXPIRED')
  return { canEdit: true, opensAt, editableUntil, blockedReason: null }
}

/** Texto del 409 cuando no se puede guardar la lista. */
export function rollCallBlockedMessage(permissions: Pick<RollCallPermissions, 'blockedReason' | 'opensAt'>): string {
  switch (permissions.blockedReason) {
    case 'LOCKED':
      return 'La planilla fue cerrada por administración.'
    case 'NOT_STARTED':
      return `La lista se abre a las ${formatUruguayHhMm(permissions.opensAt)}, ${ROLL_CALL_OPENS_BEFORE_MINUTES} minutos antes de la clase.`
    case 'NOT_ASSIGNED':
      return 'No sos el docente de esta clase.'
    default:
      return 'Se venció el plazo para editar esta lista. Pedile el cambio a administración.'
  }
}

/** Estados que el docente puede escribir. `ABSENT_JUSTIFIED` solo se alcanza vía justificación. */
export const TEACHER_WRITABLE_STATUSES = ['PRESENT', 'LATE', 'ABSENT'] as const
export type TeacherWritableStatus = (typeof TEACHER_WRITABLE_STATUSES)[number]

export function isTeacherWritableStatus(value: StudentAttendanceStatus | string): value is TeacherWritableStatus {
  return (TEACHER_WRITABLE_STATUSES as readonly string[]).includes(value)
}
