import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAttendanceOperationalSettings,
  isBiometricLateBySettings,
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

  it('marca llegada biométrica tarde solo después de la hora configurada', () => {
    const settings = { biometricLateHour: 8, biometricLateMinute: 30 }
    expect(isBiometricLateBySettings(new Date('2025-06-01T08:30:00'), settings)).toBe(false)
    expect(isBiometricLateBySettings(new Date('2025-06-01T08:31:00'), settings)).toBe(true)
    expect(isBiometricLateBySettings(new Date('2025-06-01T09:00:00'), settings)).toBe(true)
  })

  it('normaliza límites operativos de asistencia desde la fila global', async () => {
    vi.mocked(prisma.systemSettings.upsert).mockResolvedValueOnce({
      id: 'default',
      livenessCheckEnabled: false,
      attendanceNoShowGraceMinutes: 0,
      attendanceLateToleranceMinutes: -5,
      attendanceClassBridgeGapMinutes: 2000,
      attendanceMonitorEnabled: false,
      attendanceMonitorIntervalMs: 1000,
      biometricLateHour: 99,
      biometricLateMinute: 99,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })

    await expect(getAttendanceOperationalSettings()).resolves.toEqual({
      noShowGraceMinutes: 1,
      lateToleranceMinutes: 0,
      classBridgeGapMinutes: 1440,
      monitorEnabled: false,
      monitorIntervalMs: 30000,
      biometricLateHour: 23,
      biometricLateMinute: 59,
    })
  })
})
