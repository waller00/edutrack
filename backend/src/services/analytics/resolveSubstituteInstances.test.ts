import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    substitution: { findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
  },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))

import { resolveSubstituteInstances } from './resolveSubstituteInstances.js'

const now = new Date('2026-06-25T12:00:00.000Z')

function substitution(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    eventId: 'ev-sup',
    substituteUserId: 'subst-1',
    date: new Date('2026-05-20T03:00:00.000Z'),
    startTime: new Date('2026-05-20T18:00:00.000Z'),
    endTime: new Date('2026-05-20T19:00:00.000Z'),
    substitute: {
      id: 'subst-1',
      name: 'Joaquin Waller',
      username: 'joaquin.waller',
      firstName: null,
      lastName: null,
      email: 'jw@example.com',
      orgRole: { code: 'TEACHER' },
    },
    event: {
      id: 'ev-sup',
      title: 'CLASE MATEMATICA 7 EBI',
      type: 'CLASE',
      status: 'SCHEDULED',
      courseOfferingId: 'co-1',
      courseOffering: { course: { name: '7 EBI', code: '7EBI' } },
      subject: { name: 'Matemática' },
    },
    ...overrides,
  }
}

describe('resolveSubstituteInstances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.substitution.findMany.mockResolvedValue([])
    prismaMock.attendance.findMany.mockResolvedValue([])
  })

  it('omite el cálculo cuando el filtro de tipo no es CLASE', async () => {
    const out = await resolveSubstituteInstances({ from: '2026-05-01', to: '2026-05-31', eventType: 'REUNION' as any, now })
    expect(out).toHaveLength(0)
    expect(prismaMock.substitution.findMany).not.toHaveBeenCalled()
  })

  it('marca ausencia no justificada del suplente que no registró asistencia', async () => {
    prismaMock.substitution.findMany.mockResolvedValue([substitution()])
    prismaMock.attendance.findMany.mockResolvedValue([])

    const out = await resolveSubstituteInstances({ from: '2026-05-01', to: '2026-05-31', now })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      checkInStatusResolved: 'ABSENT_NOT_JUSTIFIED',
      hasCheckIn: false,
      isJustifiedAbsence: false,
      userDisplayName: 'Joaquin Waller',
      userRole: 'TEACHER',
    })
    expect(out[0]!.planned.plannedInstanceId).toBe('sub_sub-1')
    expect(out[0]!.planned.userIdRequired).toBe('subst-1')
    expect(out[0]!.planned.courseLabel).toBe('7 EBI')
  })

  it('respeta el estado registrado cuando el suplente sí asistió', async () => {
    prismaMock.substitution.findMany.mockResolvedValue([substitution()])
    prismaMock.attendance.findMany.mockResolvedValue([
      {
        userId: 'subst-1',
        eventId: 'ev-sup',
        date: new Date('2026-05-20T03:00:00.000Z'),
        time: new Date('2026-05-20T18:05:00.000Z'),
        type: 'CHECK_IN',
        status: 'LATE',
      },
    ])

    const out = await resolveSubstituteInstances({ from: '2026-05-01', to: '2026-05-31', now })
    expect(out).toHaveLength(1)
    expect(out[0]!.checkInStatusResolved).toBe('LATE')
    expect(out[0]!.hasCheckIn).toBe(true)
  })
})
