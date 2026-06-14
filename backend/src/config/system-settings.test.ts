import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAttendanceOperationalSettings,
  getMoodleOperationalSettings,
  isDiditConfigured,
  isLivenessRequiredForRegistration,
} from './system-settings.js'
import { prisma } from '../db/prisma.js'

vi.mock('../db/prisma.js', () => ({
  prisma: {
    systemSettings: {
      upsert: vi.fn(),
    },
  },
}))

describe('system-settings', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('detecta Didit configurado solo cuando key y workflow tienen valor', () => {
    vi.stubEnv('DIDIT_API_KEY', ' api-key ')
    vi.stubEnv('DIDIT_WORKFLOW_ID', ' workflow-id ')
    expect(isDiditConfigured()).toBe(true)

    vi.stubEnv('DIDIT_WORKFLOW_ID', ' ')
    expect(isDiditConfigured()).toBe(false)

    vi.stubEnv('DIDIT_API_KEY', '')
    vi.stubEnv('DIDIT_WORKFLOW_ID', 'workflow-id')
    expect(isDiditConfigured()).toBe(false)
  })

  it('exige prueba de vida salvo en test o bypass explícito', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_REGISTER_WITHOUT_DIDIT', 'false')
    expect(isLivenessRequiredForRegistration()).toBe(true)

    vi.stubEnv('ALLOW_REGISTER_WITHOUT_DIDIT', 'true')
    expect(isLivenessRequiredForRegistration()).toBe(false)

    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ALLOW_REGISTER_WITHOUT_DIDIT', 'false')
    expect(isLivenessRequiredForRegistration()).toBe(false)
  })

  it('normaliza flags operativos de Moodle desde la fila global', async () => {
    vi.mocked(prisma.systemSettings.upsert).mockResolvedValueOnce({
      id: 'default',
      moodleSyncEnabled: true,
      moodleReconcileIntervalMs: 30_000,
      moodleSyncStudents: true,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    } as never)

    await expect(getMoodleOperationalSettings()).resolves.toEqual({
      syncEnabled: true,
      reconcileIntervalMs: 60_000,
      syncStudents: true,
    })
  })

  it('MOODLE_SYNC_ENABLED en env activa sync aunque BD esté en false', async () => {
    vi.stubEnv('MOODLE_SYNC_ENABLED', 'true')
    vi.mocked(prisma.systemSettings.upsert).mockResolvedValueOnce({
      id: 'default',
      moodleSyncEnabled: false,
      moodleReconcileIntervalMs: 900000,
      moodleSyncStudents: false,
    } as never)

    await expect(getMoodleOperationalSettings()).resolves.toMatchObject({
      syncEnabled: true,
    })
  })

  it('normaliza límites operativos de asistencia desde la fila global', async () => {
    vi.mocked(prisma.systemSettings.upsert).mockResolvedValueOnce({
      id: 'default',
      livenessCheckEnabled: false,
      attendanceNoShowGraceMinutes: 0,
      attendanceLateToleranceMinutes: -5,
      attendanceEarlyExitToleranceMinutes: -10,
      attendanceClassBridgeGapMinutes: 2000,
      attendanceMonitorEnabled: false,
      attendanceMonitorIntervalMs: 1000,
      biometricDuplicateWindowMinutes: 999,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })

    await expect(getAttendanceOperationalSettings()).resolves.toEqual({
      noShowGraceMinutes: 1,
      lateToleranceMinutes: 0,
      earlyExitToleranceMinutes: 0,
      classBridgeGapMinutes: 1440,
      monitorEnabled: false,
      monitorIntervalMs: 30000,
      biometricDuplicateWindowMinutes: 120,
    })
  })
})
