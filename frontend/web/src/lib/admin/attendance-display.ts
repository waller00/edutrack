import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'

export type AdminAttendanceType = 'CHECK_IN' | 'CHECK_OUT' | 'INCIDENT'

export type AdminAttendanceStatus =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT_NOT_JUSTIFIED'
  | 'ABSENT_JUSTIFIED'
  | 'EXIT'
  | 'EARLY_EXIT'
  | 'JUSTIFIED'
  | 'SUBSTITUTED'
  | 'OUT_OF_SCHEDULE'

export function getAdminAttendanceTypeStyle(type: AdminAttendanceType): string {
  if (type === 'INCIDENT') return 'bg-red-100 text-red-800'
  return type === 'CHECK_IN' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
}

export function getAdminAttendanceTypeLabel(type: AdminAttendanceType): string {
  if (type === 'INCIDENT') return 'Incidencia'
  return type === 'CHECK_IN' ? 'Entrada' : 'Salida'
}

export function getAdminAttendanceStatusStyle(status: AdminAttendanceStatus): string {
  switch (status) {
    case 'PRESENT':
    case 'EXIT':
      return 'bg-green-100 text-green-800'
    case 'LATE':
      return 'bg-yellow-100 text-yellow-800'
    case 'EARLY_EXIT':
    case 'ABSENT_NOT_JUSTIFIED':
      return 'bg-red-100 text-red-800'
    case 'ABSENT_JUSTIFIED':
    case 'JUSTIFIED':
      return 'bg-orange-100 text-orange-800'
    case 'SUBSTITUTED':
      return 'bg-rose-100 text-rose-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function getAdminAttendanceStatusLabel(status: AdminAttendanceStatus): string {
  switch (status) {
    case 'PRESENT':
      return 'Presente'
    case 'LATE':
      return 'Tarde'
    case 'EXIT':
      return 'Salida'
    case 'EARLY_EXIT':
      return 'Salida Anticipada'
    case 'ABSENT_NOT_JUSTIFIED':
      return 'Ausente (No Justificada)'
    case 'ABSENT_JUSTIFIED':
      return 'Ausente (Justificada)'
    case 'JUSTIFIED':
      return 'Justificado'
    case 'SUBSTITUTED':
      return 'Suplida'
    case 'OUT_OF_SCHEDULE':
      return 'Fuera de horario'
    default:
      return String(status)
  }
}

/**
 * Entradas de la leyenda de colores de la grilla. `label` opcional permite mostrar
 * matices que comparten color/estado (p. ej. una ausencia prevista sin suplente, que
 * es un `ABSENT_NOT_JUSTIFIED` con otro rótulo en la fila).
 */
export type AdminAttendanceLegendItem = {
  status: AdminAttendanceStatus
  label?: string
  description: string
}

export function getAdminAttendanceLegendLabel(item: AdminAttendanceLegendItem): string {
  return item.label ?? getAdminAttendanceStatusLabel(item.status)
}

export const ADMIN_ATTENDANCE_LEGEND: ReadonlyArray<AdminAttendanceLegendItem> = [
  { status: 'PRESENT', description: 'Marcó dentro de la tolerancia' },
  { status: 'LATE', description: 'Llegó tarde (fuera de tolerancia)' },
  { status: 'EXIT', description: 'Salida registrada en horario' },
  { status: 'EARLY_EXIT', description: 'Se retiró antes de hora' },
  { status: 'ABSENT_NOT_JUSTIFIED', description: 'Falta sin justificar' },
  {
    status: 'ABSENT_NOT_JUSTIFIED',
    label: 'Ausencia prevista sin justificar',
    description: 'Ausencia planificada del titular sin suplente ni justificación',
  },
  { status: 'ABSENT_JUSTIFIED', description: 'Falta justificada (licencia / justificación)' },
  { status: 'SUBSTITUTED', description: 'Ausencia prevista del titular cubierta por suplente' },
  { status: 'JUSTIFIED', description: 'Tardanza o salida justificada' },
]

export type PlannedTimeSource = {
  type: AdminAttendanceType
  event?: { startTime?: string; endTime?: string }
}

/** Hora planificada del evento en hora civil de Uruguay. */
export function getAdminAttendancePlannedTimeLabel(attendance: PlannedTimeSource): string {
  if (!attendance.event) return 'N/A'
  if ((attendance.type === 'CHECK_IN' || attendance.type === 'INCIDENT') && attendance.event.startTime) {
    return formatTimeInUruguay(attendance.event.startTime)
  }
  if (attendance.type === 'CHECK_OUT' && attendance.event.endTime) {
    return formatTimeInUruguay(attendance.event.endTime)
  }
  return 'N/A'
}

export function getAdminAttendanceDefaultStartDate(referenceYear?: number): string {
  const y = referenceYear ?? new Date().getFullYear()
  return `${y}-01-01`
}

export type AdminAttendanceListFilters = {
  startDate: string
  endDate: string
  userId: string
  eventId: string
  eventType: string
  type: string
  status: string
  role: string
}

export function buildAdminAttendanceAllQueryString(page: number, f: AdminAttendanceListFilters): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: '20',
  })
  if (f.startDate) params.set('startDate', f.startDate)
  if (f.endDate) params.set('endDate', f.endDate)
  if (f.userId) params.set('userId', f.userId)
  if (f.eventId) params.set('eventId', f.eventId)
  if (f.eventType) params.set('eventType', f.eventType)
  if (f.type) params.set('type', f.type)
  if (f.status) params.set('status', f.status)
  if (f.role) params.set('role', f.role)
  return params.toString()
}

export type AdminAttendanceExportFilters = AdminAttendanceListFilters & { eventId: string }

export function buildAttendanceExportReportQueryString(
  format: 'excel' | 'pdf',
  f: AdminAttendanceExportFilters,
): string {
  const params = new URLSearchParams({ format })
  if (f.startDate) params.set('startDate', f.startDate)
  if (f.endDate) params.set('endDate', f.endDate)
  if (f.userId) params.set('userId', f.userId)
  if (f.eventId) params.set('eventId', f.eventId)
  if (f.eventType) params.set('eventType', f.eventType)
  if (f.type) params.set('type', f.type)
  if (f.status) params.set('status', f.status)
  if (f.role) params.set('role', f.role)
  return params.toString()
}
