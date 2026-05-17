import { prisma } from '../db/prisma.js'

const DEFAULT_ID = 'default'

export function isDiditConfigured() {
  const key = (process.env.DIDIT_API_KEY || '').trim()
  const wid = (process.env.DIDIT_WORKFLOW_ID || '').trim()
  return Boolean(key && wid)
}

/**
 * Política: el alta exige Didit/prueba de vida.
 * Bypass solo para desarrollo (`ALLOW_REGISTER_WITHOUT_DIDIT=true`) o ejecución bajo Vitest (`NODE_ENV=test`).
 */
export function isLivenessRequiredForRegistration() {
  if (process.env.NODE_ENV === 'test') return false
  if ((process.env.ALLOW_REGISTER_WITHOUT_DIDIT || '').trim() === 'true') return false
  return true
}

export async function getOrCreateSystemSettings() {
  return prisma.systemSettings.upsert({
    where: { id: DEFAULT_ID },
    create: {
      id: DEFAULT_ID,
      livenessCheckEnabled: false,
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      attendanceMonitorIntervalMs: 120000,
      biometricLateHour: 8,
      biometricLateMinute: 30,
    },
    update: {},
  })
}

export async function getAttendanceOperationalSettings() {
  const row = await getOrCreateSystemSettings()
  return {
    noShowGraceMinutes: Math.max(row.attendanceNoShowGraceMinutes ?? 15, 1),
    lateToleranceMinutes: Math.max(row.attendanceLateToleranceMinutes ?? 5, 0),
    classBridgeGapMinutes: Math.min(Math.max(row.attendanceClassBridgeGapMinutes ?? 60, 1), 24 * 60),
    monitorEnabled: row.attendanceMonitorEnabled !== false,
    monitorIntervalMs: Math.max(row.attendanceMonitorIntervalMs ?? 120000, 30000),
    biometricLateHour: Math.min(Math.max(row.biometricLateHour ?? 8, 0), 23),
    biometricLateMinute: Math.min(Math.max(row.biometricLateMinute ?? 30, 0), 59),
  }
}

export function isBiometricLateBySettings(attendanceTime: Date, settings: { biometricLateHour: number; biometricLateMinute: number }) {
  return (
    attendanceTime.getHours() > settings.biometricLateHour ||
    (attendanceTime.getHours() === settings.biometricLateHour &&
      attendanceTime.getMinutes() > settings.biometricLateMinute)
  )
}
