import type { StudentAttendanceStatus } from '@prisma/client'

export type RollCallBlockReason = 'LOCKED' | 'WINDOW_EXPIRED' | 'NOT_ASSIGNED' | 'NOT_STARTED'

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
  editableUntil: Date
  blockedReason: RollCallBlockReason | null
}

/**
 * Resuelve si quien pide puede escribir la planilla.
 *
 * Administración (`scope === 'all'`) nunca queda bloqueada por la ventana; sus escrituras
 * fuera de plazo se auditan con `outsideWindow: true` en vez de rechazarse.
 */
export function resolveRollCallPermissions(params: {
  scope: 'own' | 'all'
  isAssignedTeacher: boolean
  occurrenceEndAt: Date
  takenAt: Date | null
  lockedAt: Date | null
  windowHours: number
  now?: Date
}): RollCallPermissions {
  const now = params.now ?? new Date()
  const editableUntil = computeEditableUntil({
    occurrenceEndAt: params.occurrenceEndAt,
    takenAt: params.takenAt,
    windowHours: params.windowHours,
  })

  if (params.scope === 'all') return { canEdit: true, editableUntil, blockedReason: null }
  if (!params.isAssignedTeacher) return { canEdit: false, editableUntil, blockedReason: 'NOT_ASSIGNED' }
  if (params.lockedAt && params.lockedAt.getTime() <= now.getTime()) {
    return { canEdit: false, editableUntil, blockedReason: 'LOCKED' }
  }
  if (!isWithinEditWindow(editableUntil, null, now)) {
    return { canEdit: false, editableUntil, blockedReason: 'WINDOW_EXPIRED' }
  }
  return { canEdit: true, editableUntil, blockedReason: null }
}

/** Estados que el docente puede escribir. `ABSENT_JUSTIFIED` solo se alcanza vía justificación. */
export const TEACHER_WRITABLE_STATUSES = ['PRESENT', 'LATE', 'ABSENT'] as const
export type TeacherWritableStatus = (typeof TEACHER_WRITABLE_STATUSES)[number]

export function isTeacherWritableStatus(value: StudentAttendanceStatus | string): value is TeacherWritableStatus {
  return (TEACHER_WRITABLE_STATUSES as readonly string[]).includes(value)
}
