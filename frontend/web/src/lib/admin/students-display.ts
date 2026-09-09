export const STUDENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  WITHDRAWN: 'Abandonó',
  GRADUATED: 'Egresó',
  TRANSFERRED: 'Transferido',
}

export function getStudentStatusLabel(status: string): string {
  return STUDENT_STATUS_LABEL[status] ?? (status || '—')
}

/** Badge de color por estado de matrícula (chip redondeado, mismas clases en tabla y tarjeta). */
export function getStudentStatusBadgeClass(status: string): string {
  if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-800'
  if (status === 'WITHDRAWN') return 'bg-red-100 text-red-800'
  if (status === 'GRADUATED') return 'bg-blue-100 text-blue-800'
  if (status === 'TRANSFERRED') return 'bg-amber-100 text-amber-800'
  return 'bg-gray-100 text-gray-700'
}

export type TuitionMonthState = 'paid' | 'pending' | 'none'

/** Clase del chip de mensualidad (estático, sin hover): pagado / pendiente / sin estado. */
export function tuitionMonthChipClass(status: TuitionMonthState): string {
  if (status === 'paid') return 'border-emerald-300 bg-emerald-100 text-emerald-800'
  if (status === 'pending') return 'border-amber-300 bg-amber-100 text-amber-800'
  return 'border-gray-300 bg-white text-gray-500'
}

/**
 * Variante interactiva del chip: misma paleta que `tuitionMonthChipClass` más el hover.
 * Se deriva de la estática para que ambas no puedan divergir.
 */
export function tuitionMonthButtonClass(status: TuitionMonthState): string {
  const hover =
    status === 'paid'
      ? 'hover:bg-emerald-200'
      : status === 'pending'
        ? 'hover:bg-amber-200'
        : 'hover:border-emerald-300 hover:text-emerald-700'
  return `${tuitionMonthChipClass(status)} ${hover}`
}

export function tuitionMonthLabel(status: TuitionMonthState): string {
  if (status === 'paid') return 'pagado'
  if (status === 'pending') return 'pendiente'
  return 'sin estado'
}

export type StudentListFilters = {
  q: string
  courseId: string
  orientationId: string
  status: string
  tuitionMonth: string
  tuitionPaid: string
}

/** Cantidad de filtros activos (excluye paginación y el año, que siempre tiene valor). */
export function countActiveStudentFilters(f: StudentListFilters): number {
  let n = 0
  if (f.q.trim()) n += 1
  if (f.courseId) n += 1
  if (f.orientationId) n += 1
  if (f.status) n += 1
  if (f.tuitionMonth) n += 1
  if (f.tuitionPaid === 'true' || f.tuitionPaid === 'false') n += 1
  return n
}

export type MoodleStudentState = 'VERIFIED' | 'PENDING' | 'NOT_FOUND' | 'UNAVAILABLE'

export type MoodleAccountAction = 'provision' | 'resend' | 'none'

export type MoodleStatusView = {
  label: string
  className: string
  /** Qué se puede hacer desde acá, y qué dice el botón. */
  action: MoodleAccountAction
  actionLabel: string
  /** Una línea explicando el estado; la sigla sola no dice nada. */
  hint: string
}

/**
 * Vista del estado de la cuenta Moodle.
 *
 * `linked` es lo que separa dos situaciones que antes se veían iguales, ambas como
 * "Sin sincronizar": el alumno al que **nunca** se le creó la cuenta —lo normal recién dado de
 * alta— y aquel cuya cuenta EduTrack registra pero Moodle ya no encuentra, que es una falla real.
 */
export function getMoodleStatusView(
  state: MoodleStudentState | undefined,
  options: { linked?: boolean; canProvision?: boolean } = {},
): MoodleStatusView {
  const { linked = false, canProvision = false } = options

  if (state === 'UNAVAILABLE' || state === undefined) {
    return {
      label: 'No disponible',
      className: 'bg-gray-100 text-gray-600',
      action: 'none',
      actionLabel: '',
      hint: 'La integración con Moodle no está configurada.',
    }
  }

  if (!linked) {
    return {
      label: 'Sin cuenta',
      className: 'bg-gray-100 text-gray-700',
      action: canProvision ? 'provision' : 'none',
      actionLabel: 'Crear cuenta en Moodle',
      hint: canProvision
        ? 'Todavía no tiene cuenta en el aula virtual.'
        : 'Para crear la cuenta hace falta cargarle el email y el usuario.',
    }
  }

  switch (state) {
    case 'VERIFIED':
      return {
        label: 'Verificado',
        className: 'bg-emerald-100 text-emerald-800',
        action: 'none',
        actionLabel: '',
        hint: 'Ya entró al aula virtual por lo menos una vez.',
      }
    case 'PENDING':
      return {
        label: 'Pendiente',
        className: 'bg-amber-100 text-amber-800',
        action: 'resend',
        actionLabel: 'Reenviar acceso',
        hint: 'La cuenta existe pero todavía no entró.',
      }
    default:
      return {
        label: 'Error de sincronización',
        className: 'bg-red-100 text-red-700',
        action: 'provision',
        actionLabel: 'Recrear cuenta',
        hint: 'EduTrack registra la cuenta pero Moodle no la encuentra.',
      }
  }
}

/** Solo tiene sentido reenviar el acceso si la cuenta existe y no está verificada todavía. */
export function canResendMoodleWelcome(state: MoodleStudentState | undefined): boolean {
  return state === 'PENDING' || state === 'NOT_FOUND'
}
