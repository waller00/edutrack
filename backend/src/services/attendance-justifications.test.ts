import { describe, it, expect, vi, beforeEach } from 'vitest'

const { prismaMock, recordAuditEventNowMock } = vi.hoisted(() => ({
  prismaMock: {
    attendance: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  recordAuditEventNowMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./audit-log.js', () => ({ recordAuditEventNow: recordAuditEventNowMock }))

import { justifyAttendance, AttendanceJustificationError } from './attendance-justifications.js'

function setupTransaction() {
  const update = vi.fn(async (args: any) => ({ id: args.where.id, status: args.data.status, notes: args.data.notes }))
  const executeRaw = vi.fn(async () => 1)
  prismaMock.$transaction.mockImplementation(async (cb: any) =>
    cb({ $executeRaw: executeRaw, attendance: { update } }),
  )
  return { update, executeRaw }
}

describe('justifyAttendance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rechaza motivo vacío con error 400', async () => {
    await expect(
      justifyAttendance({ attendanceId: 'a1', reason: '   ' }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.attendance.findUnique).not.toHaveBeenCalled()
  })

  it('rechaza asistencia inexistente con error 404', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue(null)
    await expect(
      justifyAttendance({ attendanceId: 'nope', reason: 'motivo administrativo' }),
    ).rejects.toBeInstanceOf(AttendanceJustificationError)
    await expect(
      justifyAttendance({ attendanceId: 'nope', reason: 'enfermo' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'ATTENDANCE_NOT_FOUND' })
  })

  it('ABSENT_NOT_JUSTIFIED → ABSENT_JUSTIFIED y concatena notas existentes', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({
      id: 'a1',
      status: 'ABSENT_NOT_JUSTIFIED',
      notes: 'nota previa',
    })
    const { update } = setupTransaction()

    const result = await justifyAttendance({ attendanceId: 'a1', reason: '  justificante administrativo  ' })

    expect(result.status).toBe('ABSENT_JUSTIFIED')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ABSENT_JUSTIFIED',
          notes: 'nota previa\nJustificación: justificante administrativo',
        }),
      }),
    )
    expect(recordAuditEventNowMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'Attendance', entityId: 'a1' }),
    )
  })

  it('LATE → JUSTIFIED y crea notas cuando no existían', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: 'a2', status: 'LATE', notes: null })
    const { update } = setupTransaction()

    const result = await justifyAttendance({ attendanceId: 'a2', reason: 'tarde por transporte' })

    expect(result.status).toBe('JUSTIFIED')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: 'Justificación: tarde por transporte' }),
      }),
    )
  })

  it('estado no contemplado → fallback JUSTIFIED', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: 'a3', status: 'PRESENT', notes: null })
    setupTransaction()

    const result = await justifyAttendance({ attendanceId: 'a3', reason: 'otro' })

    expect(result.status).toBe('JUSTIFIED')
  })

  it('propaga type, notes, attachment y actorUserId opcionales', async () => {
    prismaMock.attendance.findUnique.mockResolvedValue({ id: 'a4', status: 'EARLY_EXIT', notes: null })
    const { executeRaw } = setupTransaction()

    await justifyAttendance({
      attendanceId: 'a4',
      reason: 'salida anticipada',
      type: 'EARLY_EXIT',
      notes: '  observación  ',
      attachment: '  archivo.pdf  ',
      actorUserId: 'user-1',
    })

    expect(executeRaw).toHaveBeenCalled()
    expect(recordAuditEventNowMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'user-1' }),
    )
  })
})
