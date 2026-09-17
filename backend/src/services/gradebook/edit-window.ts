/**
 * Ventana de edición de las calificaciones.
 *
 * Espeja `student-attendance/edit-window.ts`: el docente edita durante N días desde la fecha de la
 * evaluación; pasado ese plazo sólo administración, y su escritura se audita en vez de rechazarse.
 * El límite se calcula al leer, así que acortar la ventana aplica retroactivamente.
 */

export type GradeBlockReason = 'NOT_ASSIGNED' | 'WINDOW_EXPIRED' | 'PERIOD_CLOSED' | 'ARCHIVED'

export type GradeEditPermissions = {
  canEdit: boolean
  editableUntil: Date
  blockedReason: GradeBlockReason | null
  /** La escritura ocurre fuera de plazo: exige auditoría garantizada, no fire-and-forget. */
  outsideWindow: boolean
}

/** Instante hasta el que el titular puede editar. El ancla es la fecha de la evaluación. */
export function computeEditableUntil(assessmentDate: Date, windowDays: number): Date {
  return new Date(assessmentDate.getTime() + windowDays * 86_400_000)
}

export function resolveGradeEditPermissions(params: {
  /** Alcance de `gradebook.grade`; null si no lo tiene. */
  gradeScope: 'own' | 'all' | null
  /** ¿Tiene `gradebook.manage`? Habilita escribir fuera de plazo. */
  canManage: boolean
  /** Titular o suplente de la libreta. */
  isResponsible: boolean
  assessmentDate: Date
  windowDays: number
  gradeBookStatus: 'ACTIVE' | 'ARCHIVED'
  now?: Date
}): GradeEditPermissions {
  const now = params.now ?? new Date()
  const editableUntil = computeEditableUntil(params.assessmentDate, params.windowDays)
  const expired = now.getTime() > editableUntil.getTime()

  // Un ciclo cerrado es de sólo lectura para todos, incluida administración (RF-110).
  if (params.gradeBookStatus === 'ARCHIVED') {
    return { canEdit: false, editableUntil, blockedReason: 'ARCHIVED', outsideWindow: expired }
  }

  if (params.gradeScope === null) {
    return { canEdit: false, editableUntil, blockedReason: 'NOT_ASSIGNED', outsideWindow: expired }
  }

  // `gradebook.manage` es lo que habilita corregir fuera de plazo; tener alcance `all` no alcanza.
  if (params.canManage) {
    return { canEdit: true, editableUntil, blockedReason: null, outsideWindow: expired }
  }

  if (!params.isResponsible && params.gradeScope !== 'all') {
    return { canEdit: false, editableUntil, blockedReason: 'NOT_ASSIGNED', outsideWindow: expired }
  }

  if (expired) {
    return { canEdit: false, editableUntil, blockedReason: 'WINDOW_EXPIRED', outsideWindow: true }
  }

  return { canEdit: true, editableUntil, blockedReason: null, outsideWindow: false }
}

export const GRADE_BLOCK_MESSAGES: Record<GradeBlockReason, string> = {
  NOT_ASSIGNED: 'No sos docente de esta libreta.',
  WINDOW_EXPIRED: 'Venció el plazo para editar esta evaluación. Pedí la corrección a administración.',
  PERIOD_CLOSED: 'El período está cerrado. Hay que reabrirlo para modificar calificaciones.',
  ARCHIVED: 'El ciclo lectivo está cerrado: la libreta es de sólo lectura.',
}
