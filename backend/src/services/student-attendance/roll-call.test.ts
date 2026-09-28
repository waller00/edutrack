import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    studentAttendanceSession: { findUnique: vi.fn(), upsert: vi.fn() },
    studentAttendanceEntry: { upsert: vi.fn(), update: vi.fn() },
    studentAttendanceJustification: { create: vi.fn() },
    studentAbsenceJustificationRange: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../audit-log.js', () => ({ recordAuditEvent: vi.fn(), recordAuditEventNow: vi.fn() }))

import { saveRollCall } from './roll-call.js'

const roster = ['st-1', 'st-2', 'st-3'].map((studentId) => ({
  studentId,
  studentEnrollmentId: `enr-${studentId}`,
  firstName: 'N',
  lastName: 'A',
  documentId: null,
}))

function save(entries: { studentId: string; status: 'PRESENT' | 'LATE' | 'ABSENT' }[]) {
  return saveRollCall({
    event: { id: 'ev-1' },
    occurrenceYmd: '2026-10-06',
    startAt: new Date('2026-10-06T11:00:00Z'),
    endAt: new Date('2026-10-06T11:45:00Z'),
    cohort: { schoolYearId: 'sy-1', courseOfferingId: 'off-1', orientationId: null, courseOrientationId: null, subjectId: 'sub-1' },
    roster,
    entries,
    source: 'MANUAL',
    actorUserId: 'teacher-1',
    actedAsAdmin: false,
    outsideWindow: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock))
  prismaMock.studentAttendanceSession.findUnique.mockResolvedValue(null)
  prismaMock.studentAttendanceSession.upsert.mockResolvedValue({ id: 'sess-1' })
  prismaMock.studentAttendanceEntry.upsert.mockImplementation(async (args: any) => ({
    id: `entry-${args.create.studentId}`,
    note: null,
  }))
  prismaMock.studentAttendanceJustification.create.mockResolvedValue({ id: 'just-1' })
  prismaMock.studentAttendanceEntry.update.mockResolvedValue({})
  prismaMock.studentAbsenceJustificationRange.findMany.mockResolvedValue([
    { id: 'range-1', studentId: 'st-1', reason: 'Viaje familiar', createdByUserId: 'adscripta-1' },
    { id: 'range-2', studentId: 'st-2', reason: 'Médico', createdByUserId: 'direccion-1' },
  ])
})

describe('saveRollCall con justificación previa', () => {
  it('la ausencia dentro de un rango vigente entra justificada, a nombre de quien cargó el rango', async () => {
    await save([
      { studentId: 'st-1', status: 'ABSENT' },
      { studentId: 'st-3', status: 'ABSENT' },
    ])

    // Sólo se buscan rangos para quienes quedaron ausentes.
    expect(prismaMock.studentAbsenceJustificationRange.findMany.mock.calls[0][0].where.studentId).toEqual({
      in: ['st-1', 'st-3'],
    })
    expect(prismaMock.studentAttendanceJustification.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.studentAttendanceJustification.create.mock.calls[0][0].data).toMatchObject({
      entryId: 'entry-st-1',
      rangeId: 'range-1',
      reason: 'Viaje familiar',
      createdByUserId: 'adscripta-1',
      newStatus: 'ABSENT_JUSTIFIED',
    })
    expect(prismaMock.studentAttendanceEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-st-1' },
      data: expect.objectContaining({ status: 'ABSENT_JUSTIFIED' }),
    })
  })

  it('si el alumno vino tarde o presente, gana la marca del docente', async () => {
    await save([
      { studentId: 'st-1', status: 'LATE' },
      { studentId: 'st-2', status: 'PRESENT' },
    ])

    expect(prismaMock.studentAbsenceJustificationRange.findMany).not.toHaveBeenCalled()
    expect(prismaMock.studentAttendanceJustification.create).not.toHaveBeenCalled()
  })
})
