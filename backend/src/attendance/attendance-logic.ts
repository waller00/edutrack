/**
 * Lógica pura de asistencia (testeable sin DB).
 * Usada por routes/attendance.ts
 */
import type { Prisma } from '@prisma/client'

export type RegisterStatus =
  | 'PRESENT'
  | 'LATE'
  | 'ABSENT_JUSTIFIED'
  | 'EXIT'
  | 'EARLY_EXIT'
  | 'ABSENT_NOT_JUSTIFIED'
  | 'JUSTIFIED'
  | 'FREE'
  | 'PENDING_REVIEW'
  | 'SUBSTITUTED'
  | 'SUSPENDED'
  | 'OUT_OF_SCHEDULE'
  | 'UNIDENTIFIED_PUNCH'

export function getDuplicateAttendanceMessage(type: 'CHECK_IN' | 'CHECK_OUT') {
  return `Ya existe un registro de ${type === 'CHECK_IN' ? 'entrada' : 'salida'} para este evento en esta fecha`
}

export function getAttendanceStatus(params: {
  type: 'CHECK_IN' | 'CHECK_OUT'
  actualTime: Date
  startTime?: Date | string | null
  endTime?: Date | string | null
  hasApprovedLicense: boolean
  lateToleranceMinutes?: number
}): RegisterStatus {
  if (params.hasApprovedLicense) return 'ABSENT_JUSTIFIED'
  const toleranceMinutes = params.lateToleranceMinutes ?? 5
  if (params.type === 'CHECK_IN') {
    if (!params.startTime) return 'PRESENT'
    const expectedTime = new Date(params.startTime)
    const minutesLate = Math.floor(
      (params.actualTime.getTime() - expectedTime.getTime()) / (1000 * 60)
    )
    return minutesLate > toleranceMinutes ? 'LATE' : 'PRESENT'
  }
  if (!params.endTime) return 'EXIT'
  const expectedTime = new Date(params.endTime)
  const minutesEarly = Math.floor(
    (expectedTime.getTime() - params.actualTime.getTime()) / (1000 * 60)
  )
  return minutesEarly > toleranceMinutes ? 'EARLY_EXIT' : 'EXIT'
}

export function getBiometricStatus(type: 'CHECK_IN' | 'CHECK_OUT', isLate?: boolean, isEarlyExit?: boolean) {
  if (type !== 'CHECK_IN') return isEarlyExit ? 'EARLY_EXIT' : 'EXIT'
  return isLate ? 'LATE' : 'PRESENT'
}

export function buildBiometricAttendancePayload(params: {
  userId: string
  attendanceDate: Date
  attendanceTime: Date
  deviceId?: string
  eventId?: string
  schoolYearId?: string | null
  isLate?: boolean
  isEarlyExit?: boolean
  status?: RegisterStatus
  type: 'CHECK_IN' | 'CHECK_OUT'
}): Prisma.AttendanceUncheckedCreateInput {
  const status = params.status ?? getBiometricStatus(params.type, params.isLate, params.isEarlyExit)
  const baseNote = params.type === 'CHECK_OUT' ? 'Salida automática' : 'Entrada automática'
  const lateNote = params.type === 'CHECK_IN' && status === 'LATE' ? ' - RETRASO' : ''
  const earlyExitNote = params.type === 'CHECK_OUT' && status === 'EARLY_EXIT' ? ' - SALIDA ANTICIPADA' : ''
  return {
    userId: params.userId,
    type: params.type,
    status: status as any,
    date: params.attendanceDate,
    time: params.attendanceTime,
    eventId: params.eventId,
    schoolYearId: params.schoolYearId ?? undefined,
    notes: `${baseNote}${lateNote}${earlyExitNote} - Dispositivo: ${params.deviceId || 'N/A'}`,
  }
}
