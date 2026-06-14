import { prisma } from '../db/prisma.js'
import { applyInstitutionTimezoneFromSettings } from './institution-timezone.js'

const DEFAULT_ID = 'default'

/** Lee booleanos de entorno (`true`, `1`, `yes`). */
export function parseEnvBool(name: string): boolean {
  const v = (process.env[name] || '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export function isMoodleSyncEnabledFromEnv(): boolean {
  return parseEnvBool('MOODLE_SYNC_ENABLED')
}

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
  const row = await prisma.systemSettings.upsert({
    where: { id: DEFAULT_ID },
    create: {
      id: DEFAULT_ID,
      livenessCheckEnabled: false,
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceEarlyExitToleranceMinutes: 5,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      attendanceMonitorIntervalMs: 120000,
      biometricDuplicateWindowMinutes: 5,
      moodleSyncEnabled: isMoodleSyncEnabledFromEnv(),
      moodleReconcileIntervalMs: 900000,
      moodleSyncStudents: false,
      institutionTimezone: 'America/Montevideo',
    } as any,
    update: {},
  })
  applyInstitutionTimezoneFromSettings(row as { institutionTimezone?: string | null })
  return row
}

/** Configuración operativa de la integración Moodle (worker outbox + reconciliación). */
export async function getMoodleOperationalSettings() {
  const row = (await getOrCreateSystemSettings()) as Record<string, unknown>
  const syncEnabledInDb = row.moodleSyncEnabled === true
  return {
    syncEnabled: syncEnabledInDb || isMoodleSyncEnabledFromEnv(),
    reconcileIntervalMs: Math.max(Number(row.moodleReconcileIntervalMs ?? 900000), 60000),
    syncStudents: row.moodleSyncStudents === true,
  }
}

export async function getAttendanceOperationalSettings() {
  const row = await getOrCreateSystemSettings()
  const settings = row as typeof row & {
    attendanceEarlyExitToleranceMinutes?: number | null
    biometricDuplicateWindowMinutes?: number | null
  }
  return {
    noShowGraceMinutes: Math.max(row.attendanceNoShowGraceMinutes ?? 15, 1),
    lateToleranceMinutes: Math.max(row.attendanceLateToleranceMinutes ?? 5, 0),
    earlyExitToleranceMinutes: Math.max(settings.attendanceEarlyExitToleranceMinutes ?? row.attendanceLateToleranceMinutes ?? 5, 0),
    classBridgeGapMinutes: Math.min(Math.max(row.attendanceClassBridgeGapMinutes ?? 60, 1), 24 * 60),
    monitorEnabled: row.attendanceMonitorEnabled !== false,
    monitorIntervalMs: Math.max(row.attendanceMonitorIntervalMs ?? 120000, 30000),
    biometricDuplicateWindowMinutes: Math.min(Math.max(settings.biometricDuplicateWindowMinutes ?? 5, 0), 120),
  }
}
