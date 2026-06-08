import type { EventStatus, EventType } from '@prisma/client'

export type RoleParam = string | undefined

export type AttendanceStatusResolved =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT_NOT_JUSTIFIED'
  | 'ABSENT_JUSTIFIED'
  | 'EXIT'
  | 'EARLY_EXIT'
  | 'JUSTIFIED'
  | 'FREE'
  | 'PENDING_REVIEW'
  | 'SUBSTITUTED'
  | 'SUSPENDED'
  | 'OUT_OF_SCHEDULE'
  | 'UNIDENTIFIED_PUNCH'

export type AttendanceTypeResolved = 'CHECK_IN' | 'CHECK_OUT'

export type EventStatusResolved = EventStatus
export type EventTypeResolved = EventType

export type PlannedInstance = {
  // Determístico para export/métricas: eventId_fecha
  plannedInstanceId: string
  eventId: string
  eventTitle: string
  eventType: EventType
  eventStatus: EventStatus
  isRecurringInstance: boolean
  plannedDate: string // YYYY-MM-DD (UTC)
  plannedStartTime: Date | null
  plannedEndTime: Date | null
  userIdRequired: string | null
  // Contexto académico (opcional) para desgloses por curso/asignatura.
  courseOfferingId: string | null
  courseLabel: string | null
  subjectLabel: string | null
}

export type ResolvedAttendanceByInstance = {
  planned: PlannedInstance
  // CHECK_IN/EXIT se resuelven con preferencia a Attendance.status persistido.
  checkInStatusResolved: AttendanceStatusResolved
  checkOutStatusResolved: AttendanceStatusResolved
  hasCheckIn: boolean
  hasCheckOut: boolean
  actualInTime: Date | null
  actualOutTime: Date | null
  durationMinutes: number // >= 0
  // Justificación por licencia para AUSENCIAS.
  isJustifiedAbsence: boolean
  licenseIdJustifying: string | null
  checkInNotes: string | null
  checkOutNotes: string | null
  userDisplayName: string
  userRole: string
  userEmail: string
}

export type DashboardKpis = {
  M1_PUNCTUALITY_pct: number
  M2_LATE_RATE_pct: number
  M4_AOP_pct: number
  M6_COVERAGE_CP_pct: number
  M8_HOURS_DELTA_pct: number
  PC_count: number
}

/** Personas con más incidencias (tarde + ausencias no justificadas) en el período filtrado. */
export type DashboardTopRiskPerson = {
  userId: string
  displayName: string
  role: string
  plannedCount: number
  lateCount: number
  absentNotJustifiedCount: number
  absentJustifiedCount: number
  /** Heurística ordenable para priorizar seguimiento (no es nota disciplinaria). */
  riskScore: number
}

/** Eventos con peor desempeño agregado (tasa tardanza + absentismo sobre plan). */
export type DashboardTopRiskEvent = {
  eventId: string
  title: string
  eventType: string
  plannedCount: number
  lateRatePct: number
  absentOverPlanPct: number
  /** Suma tardanza + absentismo para ordenar rankings. */
  focusScore: number
}

/** Fila de desglose de KPIs por una dimensión (rol, tipo de evento, curso…). */
export type DashboardBreakdownRow = {
  key: string
  label: string
  plannedCount: number
  punctualityPct: number
  lateRatePct: number
  aopPct: number
  coveragePct: number
}

/** Conteo + porcentaje de cada estado de entrada sobre el total planificado. */
export type StatusDistributionRow = {
  status: AttendanceStatusResolved
  count: number
  pct: number
}

export type StatusDistribution = {
  totalPlanned: number
  rows: StatusDistributionRow[]
}

export type SeriesGranularity = 'day' | 'week' | 'month'

/** Punto de serie multi-métrica para gráficos de tendencia combinados. */
export type SeriesPointMulti = {
  period: string // YYYY-MM-DD (inicio del bucket, UTC)
  lateRate: number
  aop: number
  coverage: number
}

/** Comparación período actual vs período anterior de igual longitud. */
export type PeriodComparison = {
  previousFrom: string
  previousTo: string
  current: DashboardKpis
  previous: DashboardKpis
  deltas: DashboardKpis
}

/** Conjunto de desgloses por dimensión incluidos en el dashboard. */
export type DashboardBreakdowns = {
  byRole: DashboardBreakdownRow[]
  byEventType: DashboardBreakdownRow[]
  byCourse: DashboardBreakdownRow[]
}
