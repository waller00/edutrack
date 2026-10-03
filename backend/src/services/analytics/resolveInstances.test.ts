import { describe, expect, it, vi, beforeEach } from 'vitest'
import { resolveAttendanceAndJustification } from './resolveInstances.js'
import type { PlannedInstance } from './models.js'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    attendance: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    medicalLeave: { findMany: vi.fn() },
  },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))

function planned(overrides: Partial<PlannedInstance> & Pick<PlannedInstance, 'eventId' | 'plannedInstanceId'>): PlannedInstance {
  return {
    eventId: overrides.eventId,
    plannedInstanceId: overrides.plannedInstanceId,
    eventTitle: overrides.eventTitle ?? overrides.eventId,
    eventType: (overrides.eventType ?? 'CLASE') as any,
    eventStatus: (overrides.eventStatus ?? 'SCHEDULED') as any,
    isRecurringInstance: false,
    plannedDate: overrides.plannedDate ?? '2026-05-24',
    plannedStartTime: overrides.plannedStartTime ?? new Date('2026-05-24T21:40:00.000Z'),
    plannedEndTime: overrides.plannedEndTime ?? new Date('2026-05-24T22:30:00.000Z'),
    userIdRequired: overrides.userIdRequired ?? 'user-1',
  }
}

describe('resolveAttendanceAndJustification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'jorge@example.com',
        name: 'Jorge',
        username: 'jorge',
        firstName: 'Jorge',
        lastName: 'Docente',
        orgRole: { code: 'TEACHER' },
      },
    ])
    prismaMock.medicalLeave.findMany.mockResolvedValue([])
  })

  it('resuelve como presentes dos clases contiguas cubiertas por una sola entrada y una sola salida', async () => {
    const class1 = planned({
      eventId: 'class-1',
      plannedInstanceId: 'class-1_2026-05-24',
      eventTitle: 'Clase 1',
      plannedStartTime: new Date('2026-05-24T21:40:00.000Z'),
      plannedEndTime: new Date('2026-05-24T22:30:00.000Z'),
    })
    const class2 = planned({
      eventId: 'class-2',
      plannedInstanceId: 'class-2_2026-05-24',
      eventTitle: 'Clase 2',
      plannedStartTime: new Date('2026-05-24T22:30:00.000Z'),
      plannedEndTime: new Date('2026-05-24T23:20:00.000Z'),
    })

    prismaMock.attendance.findMany.mockResolvedValue([
      {
        id: 'in-1',
        userId: 'user-1',
        eventId: 'class-1',
        date: new Date('2026-05-24T00:00:00.000Z'),
        time: new Date('2026-05-24T21:33:00.000Z'),
        type: 'CHECK_IN',
        status: 'PRESENT',
        notes: 'Entrada automática',
      },
      {
        id: 'out-1',
        userId: 'user-1',
        eventId: 'class-2',
        date: new Date('2026-05-24T00:00:00.000Z'),
        time: new Date('2026-05-24T23:27:00.000Z'),
        type: 'CHECK_OUT',
        status: 'EXIT',
        notes: 'Salida automática',
      },
    ])

    const resolved = await resolveAttendanceAndJustification({ plannedInstances: [class1, class2] })

    expect(resolved).toHaveLength(2)
    expect(resolved.map((r) => r.checkInStatusResolved)).toEqual(['PRESENT', 'PRESENT'])
    expect(resolved.map((r) => r.checkOutStatusResolved)).toEqual(['EXIT', 'EXIT'])
    expect(resolved.map((r) => r.hasCheckIn)).toEqual([true, true])
    expect(resolved.map((r) => r.hasCheckOut)).toEqual([true, true])
    expect(resolved.map((r) => r.durationMinutes)).toEqual([50, 50])
    expect(resolved[1]!.checkInNotes).toBe('Entrada automática')
    expect(resolved[1]!.checkOutNotes).toBe('Salida automática')
  })

  it('asigna cada marca a la instancia de su propio usuario (titular suplido vs suplente presente)', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'titular', email: 't@e', name: 'Tit', username: 'tit', firstName: 'Tit', lastName: 'Ular', orgRole: { code: 'TEACHER' } },
      { id: 'suplente', email: 's@e', name: 'Sup', username: 'sup', firstName: 'Sup', lastName: 'Lente', orgRole: { code: 'TEACHER' } },
    ])
    const titularInst = planned({ eventId: 'ev-bio', plannedInstanceId: 'ev-bio_2026-05-24', userIdRequired: 'titular' })
    const subInst = planned({
      eventId: 'ev-bio',
      plannedInstanceId: 'ev-bio_2026-05-24__sub__suplente',
      userIdRequired: 'suplente',
    })

    prismaMock.attendance.findMany.mockResolvedValue([
      {
        id: 't-in',
        userId: 'titular',
        eventId: 'ev-bio',
        date: new Date('2026-05-24T00:00:00.000Z'),
        time: new Date('2026-05-24T21:42:00.000Z'),
        type: 'CHECK_IN',
        status: 'SUBSTITUTED',
        notes: 'suplida',
      },
      {
        id: 's-in',
        userId: 'suplente',
        eventId: 'ev-bio',
        date: new Date('2026-05-24T00:00:00.000Z'),
        time: new Date('2026-05-24T21:39:00.000Z'),
        type: 'CHECK_IN',
        status: 'PRESENT',
        notes: 'cubre',
      },
    ])

    const resolved = await resolveAttendanceAndJustification({ plannedInstances: [titularInst, subInst] })
    const byUser = new Map(resolved.map((r) => [r.planned.userIdRequired, r]))
    expect(byUser.get('titular')!.checkInStatusResolved).toBe('SUBSTITUTED')
    expect(byUser.get('suplente')!.checkInStatusResolved).toBe('PRESENT')
  })
})
