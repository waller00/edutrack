import type { AttendanceStatus, AttendanceType, EventStatus, EventType, RecurrenceType, Role } from '@prisma/client'

export type RoleParam = Role | undefined

export type AttendanceStatusResolved =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT_NOT_JUSTIFIED'
  | 'ABSENT_JUSTIFIED'
  | 'EXIT'
  | 'EARLY_EXIT'

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
  userRole: Role
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

