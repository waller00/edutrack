/** Tipos operativos en UI (crear/editar/filtrar). Eventos legacy en BD siguen mostrándose por etiqueta. */
export type AdminEventType = 'JORNADA_LABORAL' | 'REUNION' | 'CLASE'

export const ADMIN_EVENT_TYPE_SELECT_OPTIONS: { value: AdminEventType; label: string }[] = [
  { value: 'CLASE', label: 'Clase' },
  { value: 'JORNADA_LABORAL', label: 'Jornada laboral' },
  { value: 'REUNION', label: 'Reunión' },
]

export type AdminEventStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'

export type AdminEventCreatorRole = 'TEACHER' | 'STAFF' | ''

export function getAdminEventTypeLabel(type: string): string {
  switch (type) {
    case 'JORNADA_LABORAL':
      return 'Jornada laboral'
    case 'REUNION':
      return 'Reunión'
    case 'CLASE':
      return 'Clase'
    case 'EVENTO':
      return 'Evento'
    case 'CAPACITACION':
      return 'Capacitación'
    case 'CITA_MEDICA':
      return 'Cita médica'
    default:
      return type
  }
}

export function getAdminEventStatusStyle(status: string): string {
  switch (status as AdminEventStatus) {
    case 'SCHEDULED':
      return 'bg-blue-100 text-blue-800'
    case 'IN_PROGRESS':
      return 'bg-yellow-100 text-yellow-800'
    case 'COMPLETED':
      return 'bg-green-100 text-green-800'
    case 'EXPIRED':
      return 'bg-gray-100 text-gray-800'
    case 'CANCELLED':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function getAdminEventStatusLabel(status: string): string {
  switch (status) {
    case 'SCHEDULED':
      return 'Programado'
    case 'IN_PROGRESS':
      return 'En curso'
    case 'COMPLETED':
      return 'Completado'
    case 'EXPIRED':
      return 'Vencido'
    case 'CANCELLED':
      return 'Cancelado'
    default:
      return status
  }
}

export function getAdminEventRoleTypeOptions(role: AdminEventCreatorRole): { value: string; label: string }[] {
  if (role === 'TEACHER') {
    return [
      { value: 'CLASE', label: 'Clase' },
      { value: 'REUNION', label: 'Reunión' },
    ]
  }
  if (role === 'STAFF') {
    return [
      { value: 'JORNADA_LABORAL', label: 'Jornada laboral' },
      { value: 'REUNION', label: 'Reunión' },
    ]
  }
  return []
}

export function getAdminEventsDefaultStartDate(referenceYear?: number): string {
  const y = referenceYear ?? new Date().getFullYear()
  return `${y}-01-01`
}

export type AdminEventsListFilters = {
  startDate: string
  endDate: string
  userId: string
  assignedUserId: string
  courseId: string
  type: string
  status: string
}

export function buildAdminEventsAllQueryString(
  page: number,
  f: AdminEventsListFilters,
  extra?: { schoolYearId?: string; allYears?: boolean },
): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '20',
  })
  if (f.startDate) params.set('startDate', f.startDate)
  if (f.endDate) params.set('endDate', f.endDate)
  if (f.userId) params.set('userId', f.userId)
  if (f.assignedUserId) params.set('assignedUserId', f.assignedUserId)
  if (f.courseId) params.set('courseId', f.courseId)
  if (f.type) params.set('type', f.type)
  if (f.status) params.set('status', f.status)
  if (extra?.allYears) params.set('allYears', '1')
  else if (extra?.schoolYearId) params.set('schoolYearId', extra.schoolYearId)
  return params.toString()
}
