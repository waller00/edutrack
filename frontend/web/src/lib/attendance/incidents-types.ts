export type AttendanceIncidentRow = {
  id: string
  type: 'LATE_ARRIVAL' | 'TEACHER_NO_SHOW' | 'EARLY_EXIT'
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  detectedAt: string
  description?: string | null
  user?: { id: string; name: string | null; email: string }
  event?: { id: string; title: string; type: string; startTime?: string | null; endTime?: string | null }
  attendance?: { id: string; type: string; status: string; time: string } | null
}

export type IncidentListResponse = {
  total: number
  page: number
  pageSize: number
  data: AttendanceIncidentRow[]
}

export const INCIDENT_TYPE_LABELS: Record<AttendanceIncidentRow['type'], string> = {
  LATE_ARRIVAL: 'Llegada tarde',
  TEACHER_NO_SHOW: 'Ausencia docente',
  EARLY_EXIT: 'Salida anticipada',
}

export const INCIDENT_STATUS_LABELS: Record<AttendanceIncidentRow['status'], string> = {
  OPEN: 'Abierta',
  ACKNOWLEDGED: 'Reconocida',
  RESOLVED: 'Resuelta',
}
