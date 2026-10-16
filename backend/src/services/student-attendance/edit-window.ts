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
 * Tope de la ventana del docente: la lista de una clase se puede pasar o corregir hasta una semana
 * después de que terminó. Más allá ya no es "pasar la lista tarde", es reconstruirla de memoria, y
 * eso lo hace administración (que no tiene ventana y queda auditada).
 */
export const ROLL_CALL_MAX_WINDOW_HOURS = 168

/**
 * Instante hasta el que el docente puede pasar o editar la planilla.
 *
 * El ancla es el **fin de la clase**, no el momento en que se pasó: anclada en `takenAt`, pasar la
 * lista el sexto día abría otra ventana entera y el tope de una semana dejaba de ser tope. El valor
 * se CALCULA en cada lectura (no se congela al guardar), así que cambiar la ventana aplica
 * retroactivamente. `takenAt` se acepta por compatibilidad y no mueve el ancla.
 */
export function computeEditableUntil(params: {
  occurrenceEndAt: Date
  takenAt?: Date | null
  windowHours: number
}): Date {
  const hours = Math.min(Math.max(params.windowHours, 0), ROLL_CALL_MAX_WINDOW_HOURS)
  return new Date(params.occurrenceEndAt.getTime() + hours * 3_600_000)
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
      return 'Se venció el plazo: la lista se puede pasar hasta una semana después de la clase. Pedile el cambio a administración.'
  }
}

/** Estados que el docente puede escribir. `ABSENT_JUSTIFIED` solo se alcanza vía justificación. */
export const TEACHER_WRITABLE_STATUSES = ['PRESENT', 'LATE', 'ABSENT'] as const
export type TeacherWritableStatus = (typeof TEACHER_WRITABLE_STATUSES)[number]

export function isTeacherWritableStatus(value: StudentAttendanceStatus | string): value is TeacherWritableStatus {
  return (TEACHER_WRITABLE_STATUSES as readonly string[]).includes(value)
}
