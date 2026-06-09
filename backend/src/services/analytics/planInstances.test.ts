import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))

import { getPlannedInstances } from './planInstances.js'

describe('getPlannedInstances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.event.findMany.mockResolvedValue([])
  })

  it('filtra eventos planificados por ciclo lectivo cuando se recibe schoolYearId', async () => {
    await getPlannedInstances({
      from: '2026-03-01',
      to: '2026-03-31',
      schoolYearId: 'sy-2026',
    })

    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolYearId: 'sy-2026',
        }),
      }),
    )
  })

  it('no aplica filtro de ciclo cuando se consulta todos los ciclos', async () => {
    await getPlannedInstances({
      from: '2026-03-01',
      to: '2026-03-31',
    })

    const where = prismaMock.event.findMany.mock.calls[0][0].where
    expect(where.schoolYearId).toBeUndefined()
  })

  it('asigna eventos nocturnos al día civil de Uruguay', async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: 'ev-night',
        title: 'Evento ausencia aunt.',
        type: 'CLASE',
        status: 'SCHEDULED',
        startDate: new Date('2026-06-09T01:21:00.000Z'),
        startTime: new Date('2026-06-09T01:21:00.000Z'),
        endTime: new Date('2026-06-09T01:30:00.000Z'),
        isRecurring: false,
        recurrenceEnd: null,
        daysOfWeek: [],
        effectiveFrom: null,
        effectiveUntil: null,
        assignedUserId: 'teacher-1',
        courseOfferingId: null,
        courseOffering: null,
        subject: null,
      },
    ])

    const previousUruguayDay = await getPlannedInstances({
      from: '2026-06-08',
      to: '2026-06-08',
    })
    const nextUtcDay = await getPlannedInstances({
      from: '2026-06-09',
      to: '2026-06-09',
    })

    expect(previousUruguayDay).toHaveLength(1)
    expect(previousUruguayDay[0]).toMatchObject({
      plannedInstanceId: 'ev-night_2026-06-08',
      plannedDate: '2026-06-08',
    })
    expect(previousUruguayDay[0]!.plannedStartTime?.toISOString()).toBe('2026-06-09T01:21:00.000Z')
    expect(previousUruguayDay[0]!.plannedEndTime?.toISOString()).toBe('2026-06-09T01:30:00.000Z')
    expect(nextUtcDay).toHaveLength(0)
  })
})
