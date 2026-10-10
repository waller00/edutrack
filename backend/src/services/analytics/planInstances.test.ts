import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))

import { commitmentStartOf, getPlannedInstances } from './planInstances.js'
import { startedBeforeCommitment } from './resolveInstances.js'

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

describe('desde cuándo una ocurrencia es un compromiso del docente', () => {
  const createdAt = new Date('2026-10-08T21:00:00.000Z') // jueves 8/10, 18:00 en Uruguay

  it('una serie cuenta desde que se cargó, y no antes de que exista el docente', () => {
    expect(commitmentStartOf({ createdAt, revisionOf: null, assignedUser: { createdAt: new Date('2026-03-01T12:00:00.000Z') } })).toEqual(createdAt)
    const teacherJoined = new Date('2026-10-09T12:00:00.000Z')
    expect(commitmentStartOf({ createdAt, revisionOf: null, assignedUser: { createdAt: teacherJoined } })).toEqual(teacherJoined)
  })

  it('una versión nueva de la serie hereda la historia: sólo cuenta el docente', () => {
    const teacher = new Date('2026-03-01T12:00:00.000Z')
    expect(commitmentStartOf({ createdAt, revisionOf: 'root-1', assignedUser: { createdAt: teacher } })).toEqual(teacher)
  })

  it('sin datos no limita nada', () => {
    expect(commitmentStartOf({ createdAt: null, revisionOf: null, assignedUser: null })).toBeNull()
  })

  it('docente nuevo: el horario cargado a la tarde no le cuenta la clase de esa mañana ni las anteriores', async () => {
    prismaMock.event.findMany.mockResolvedValue([
      {
        id: 'ev-nuevo',
        title: 'Matemática 3.º B',
        type: 'CLASE',
        status: 'SCHEDULED',
        // Anclada al lunes 5/10 a las 9:00, cargada el jueves 8/10 a las 18:00.
        startDate: new Date('2026-10-05T12:00:00.000Z'),
        startTime: new Date('2026-10-05T12:00:00.000Z'),
        endTime: new Date('2026-10-05T12:45:00.000Z'),
        isRecurring: true,
        recurrenceEnd: null,
        daysOfWeek: [1, 4],
        effectiveFrom: null,
        effectiveUntil: null,
        assignedUserId: 'docente-nuevo',
        courseOfferingId: null,
        courseOffering: null,
        subject: null,
        createdAt,
        revisionOf: null,
        assignedUser: { createdAt: new Date('2026-10-08T20:30:00.000Z') },
      },
    ])

    const instances = await getPlannedInstances({ from: '2026-10-05', to: '2026-10-12' })

    expect(instances.map((i) => i.plannedDate)).toEqual(['2026-10-05', '2026-10-08', '2026-10-12'])
    expect(instances.map((i) => startedBeforeCommitment(i))).toEqual([true, true, false])
  })
})
