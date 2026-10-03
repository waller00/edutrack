import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, auditMock } = vi.hoisted(() => ({
  prismaMock: {
    studentEnrollment: { findFirst: vi.fn() },
    studentAbsenceJustificationRange: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    studentAttendanceEntry: { findMany: vi.fn(), update: vi.fn() },
    studentAttendanceJustification: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  auditMock: { recordAuditEventNow: vi.fn(), recordAuditEvent: vi.fn() },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../audit-log.js', () => auditMock)

import {
  activeRangesFor,
  createJustificationRange,
  revokeJustificationRange,
} from './justification-range.js'

const EBI_ENROLLMENT = { schoolYearId: 'sy-1', courseOffering: { course: { level: 'EBI' } } }
const BASE = { studentId: 'st-1', fromYmd: '2026-10-05', toYmd: '2026-10-07', reason: 'Viaje familiar', actorUserId: 'adscripta-1' }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock))
  prismaMock.studentEnrollment.findFirst.mockResolvedValue(EBI_ENROLLMENT)
  prismaMock.studentAbsenceJustificationRange.create.mockResolvedValue({ id: 'range-1' })
  prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([])
  prismaMock.studentAttendanceJustification.create.mockResolvedValue({ id: 'just-1' })
  prismaMock.studentAttendanceEntry.update.mockResolvedValue({})
})

describe('createJustificationRange', () => {
  it('exige motivo', async () => {
    await expect(createJustificationRange({ ...BASE, reason: '  ' })).rejects.toMatchObject({ code: 'REASON_REQUIRED' })
  })

  it('rechaza un rango invertido', async () => {
    await expect(
      createJustificationRange({ ...BASE, fromYmd: '2026-10-07', toYmd: '2026-10-05' }),
    ).rejects.toMatchObject({ code: 'INVALID_RANGE' })
  })

  it('sólo aplica a ciclo básico', async () => {
    prismaMock.studentEnrollment.findFirst.mockResolvedValue({
      schoolYearId: 'sy-1',
      courseOffering: { course: { level: 'EMS' } },
    })
    await expect(createJustificationRange(BASE)).rejects.toMatchObject({ statusCode: 409, code: 'NOT_BASIC_CYCLE' })
    expect(prismaMock.studentAbsenceJustificationRange.create).not.toHaveBeenCalled()
  })

  it('sin matrícula activa no hay a quién justificar', async () => {
    prismaMock.studentEnrollment.findFirst.mockResolvedValue(null)
    await expect(createJustificationRange(BASE)).rejects.toMatchObject({ code: 'NO_ENROLLMENT' })
  })

  it('previa: crea el rango aunque todavía no haya marcas', async () => {
    const result = await createJustificationRange(BASE)
    expect(result.justifiedCount).toBe(0)
    expect(prismaMock.studentAbsenceJustificationRange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ studentId: 'st-1', schoolYearId: 'sy-1', fromYmd: '2026-10-05', toYmd: '2026-10-07' }),
    })
    expect(auditMock.recordAuditEventNow).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STUDENT_ATTENDANCE_RANGE_JUSTIFIED', entityId: 'range-1' }),
    )
  })

  it('posterior: justifica sólo las ausencias ya marcadas dentro del rango', async () => {
    prismaMock.studentAttendanceEntry.findMany.mockResolvedValue([
      { id: 'e-1', note: null },
      { id: 'e-2', note: 'avisó' },
    ])

    const result = await createJustificationRange(BASE)

    // Las tardes y las presencias no se buscan: sólo ABSENT dentro del rango.
    expect(prismaMock.studentAttendanceEntry.findMany.mock.calls[0][0].where).toEqual({
      studentId: 'st-1',
      status: 'ABSENT',
      session: { schoolYearId: 'sy-1', occurrenceYmd: { gte: '2026-10-05', lte: '2026-10-07' } },
    })
    expect(result.justifiedCount).toBe(2)
    expect(prismaMock.studentAttendanceJustification.create).toHaveBeenCalledTimes(2)
    expect(prismaMock.studentAttendanceJustification.create.mock.calls[0][0].data).toMatchObject({
      entryId: 'e-1',
      rangeId: 'range-1',
      previousStatus: 'ABSENT',
      newStatus: 'ABSENT_JUSTIFIED',
      createdByUserId: 'adscripta-1',
    })
    expect(prismaMock.studentAttendanceEntry.update).toHaveBeenCalledWith({
      where: { id: 'e-2' },
      data: expect.objectContaining({ status: 'ABSENT_JUSTIFIED' }),
    })
  })
})

describe('revokeJustificationRange', () => {
  it('deja de aplicar el rango sin tocar lo ya justificado', async () => {
    prismaMock.studentAbsenceJustificationRange.findUnique.mockResolvedValue({ id: 'range-1', revokedAt: null })
    prismaMock.studentAbsenceJustificationRange.update.mockResolvedValue({ id: 'range-1' })

    await revokeJustificationRange({ rangeId: 'range-1', actorUserId: 'direccion-1' })

    expect(prismaMock.studentAbsenceJustificationRange.update).toHaveBeenCalledWith({
      where: { id: 'range-1' },
      data: { revokedAt: expect.any(Date), revokedByUserId: 'direccion-1' },
    })
    expect(prismaMock.studentAttendanceEntry.update).not.toHaveBeenCalled()
  })

  it('no revoca dos veces', async () => {
    prismaMock.studentAbsenceJustificationRange.findUnique.mockResolvedValue({ id: 'range-1', revokedAt: new Date() })
    await expect(revokeJustificationRange({ rangeId: 'range-1' })).rejects.toMatchObject({ code: 'ALREADY_REVOKED' })
  })

  it('404 si no existe', async () => {
    prismaMock.studentAbsenceJustificationRange.findUnique.mockResolvedValue(null)
    await expect(revokeJustificationRange({ rangeId: 'x' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('activeRangesFor', () => {
  it('busca sólo rangos vigentes que cubran el día', async () => {
    prismaMock.studentAbsenceJustificationRange.findMany.mockResolvedValue([
      { id: 'r-1', studentId: 'st-1', reason: 'Viaje', createdByUserId: 'u-1' },
      { id: 'r-2', studentId: 'st-1', reason: 'Otro', createdByUserId: 'u-2' },
    ])

    const ranges = await activeRangesFor(['st-1', 'st-2'], '2026-10-06')

    expect(prismaMock.studentAbsenceJustificationRange.findMany.mock.calls[0][0].where).toEqual({
      studentId: { in: ['st-1', 'st-2'] },
      revokedAt: null,
      fromYmd: { lte: '2026-10-06' },
      toYmd: { gte: '2026-10-06' },
    })
    // Si dos rangos se pisan, vale el primero: una sola justificación por marca.
    expect(ranges.get('st-1')).toEqual({ id: 'r-1', reason: 'Viaje', createdByUserId: 'u-1' })
    expect(ranges.has('st-2')).toBe(false)
  })

  it('sin estudiantes no consulta', async () => {
    expect((await activeRangesFor([], '2026-10-06')).size).toBe(0)
    expect(prismaMock.studentAbsenceJustificationRange.findMany).not.toHaveBeenCalled()
  })
})
