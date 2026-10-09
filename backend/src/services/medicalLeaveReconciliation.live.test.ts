import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    medicalLeave: { findUnique: vi.fn(), findMany: vi.fn() },
    event: { findMany: vi.fn() },
    attendance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
// Cada evento del test trae sus ocurrencias ya expandidas.
vi.mock('../events/events-query.js', () => ({
  expandRecurringEvent: (event: { occurrences: unknown[] }) => event.occurrences,
}))

import { reconcileAttendancesForMedicalLeave, removeFutureLicenseAbsences, revertActionFor } from './medicalLeaveReconciliation.js'

// Licencia del lunes 2 al jueves 5 de junio de 2025, cargada el martes 3 a las 15:00 (Uruguay).
const LICENSE = {
  id: 'lic-1',
  userId: 'u-1',
  status: 'ACTIVE',
  startDate: new Date('2025-06-02T12:00:00.000Z'),
  endDate: new Date('2025-06-05T12:00:00.000Z'),
}
const NOW = new Date('2025-06-03T18:00:00.000Z')

const occurrence = (id: string, start: string, end: string) => ({
  id: `ev-1_${id}`,
  originalEventId: 'ev-1',
  status: 'SCHEDULED',
  startTime: start,
  endTime: end,
})

describe('conciliación de licencias en vivo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.medicalLeave.findUnique.mockResolvedValue(LICENSE)
    prismaMock.medicalLeave.findMany.mockResolvedValue([])
    prismaMock.attendance.findMany.mockResolvedValue([])
    prismaMock.attendance.findFirst.mockResolvedValue(null)
    prismaMock.attendance.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: 'ev-1',
        schoolYearId: 'sy-1',
        occurrences: [
          // Lunes 7:30–9:00: ya pasó. Antes quedaba afuera (la licencia empezaba a las 9:00).
          occurrence('lun', '2025-06-02T10:30:00.000Z', '2025-06-02T12:00:00.000Z'),
          // Jueves: todavía no pasó.
          occurrence('jue', '2025-06-05T10:30:00.000Z', '2025-06-05T12:00:00.000Z'),
        ],
      },
    ])
  })

  it('justifica sólo las clases que ya terminaron; la del jueves aparece el jueves', async () => {
    const result = await reconcileAttendancesForMedicalLeave('lic-1', NOW)

    expect(result.created).toBe(1)
    expect(prismaMock.attendance.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.attendance.create.mock.calls[0][0].data).toMatchObject({
      status: 'ABSENT_JUSTIFIED',
      time: new Date('2025-06-02T10:30:00.000Z'),
    })
  })

  it('una licencia que empieza más adelante no crea nada todavía', async () => {
    const result = await reconcileAttendancesForMedicalLeave('lic-1', new Date('2025-06-01T12:00:00.000Z'))

    expect(result.created).toBe(0)
    expect(prismaMock.attendance.create).not.toHaveBeenCalled()
    expect(prismaMock.event.findMany).not.toHaveBeenCalled()
  })
})

describe('revertActionFor', () => {
  const now = new Date('2025-06-10T12:00:00.000Z')
  const created = {
    status: 'ABSENT_JUSTIFIED' as const,
    time: new Date('2025-06-03T11:00:00.000Z'),
    notes: '[LIC-AUTO] 2025-06-03T12:00:00.000Z licencia=lic-1 crear ausencia justificada por licencia · evento=ev-1',
    _count: { justifications: 0 },
  }
  const justified = { ...created, notes: '[LIC-AUTO] x licencia=lic-1 ABSENT_NOT_JUSTIFIED→ABSENT_JUSTIFIED' }

  it('mientras la licencia cubre la clase, queda', () => {
    expect(revertActionFor(created, 'lic-1', true, now)).toBe('keep')
  })

  it('si ya no la cubre, lo creado se borra y lo justificado vuelve a sin justificar', () => {
    expect(revertActionFor(created, 'lic-1', false, now)).toBe('remove')
    expect(revertActionFor(justified, 'lic-1', false, now)).toBe('revert')
  })

  it('lo creado para una clase que todavía no pasó se borra aunque la cubra', () => {
    expect(revertActionFor({ ...created, time: new Date('2025-06-12T11:00:00.000Z') }, 'lic-1', true, now)).toBe('remove')
  })

  it('una justificación a mano, o una asistencia que no es ausencia justificada, no se toca', () => {
    expect(revertActionFor({ ...justified, _count: { justifications: 1 } }, 'lic-1', false, now)).toBe('keep')
    expect(revertActionFor({ ...created, status: 'PRESENT' as const }, 'lic-1', false, now)).toBe('keep')
  })

  it('no confunde licencias con un id que empieza igual', () => {
    expect(revertActionFor(created, 'lic', false, now)).toBe('revert')
  })
})

describe('removeFutureLicenseAbsences', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin --apply sólo cuenta; con --apply borra las de clases futuras sin justificación a mano', async () => {
    prismaMock.attendance.count.mockResolvedValue(3)
    prismaMock.attendance.deleteMany.mockResolvedValue({ count: 3 })

    expect(await removeFutureLicenseAbsences(false, NOW)).toBe(3)
    expect(prismaMock.attendance.deleteMany).not.toHaveBeenCalled()

    expect(await removeFutureLicenseAbsences(true, NOW)).toBe(3)
    expect(prismaMock.attendance.deleteMany.mock.calls[0][0].where).toMatchObject({
      status: 'ABSENT_JUSTIFIED',
      time: { gt: NOW },
      justifications: { none: {} },
    })
  })
})
