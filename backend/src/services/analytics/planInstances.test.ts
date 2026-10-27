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

  it('una serie que empieza justo en `from` cuenta ese día, y `to` es inclusivo', async () => {
    prismaMock.event.findMany.mockResolvedValue([eventRow({ id: 'ev-lunes', daysOfWeek: [1] })])

    const instances = await getPlannedInstances({ from: '2026-03-02', to: '2026-03-09' })

    expect(instances.map(summary)).toEqual([
      ['2026-03-02', 'ev-lunes', '2026-03-02T11:00:00.000Z', '2026-03-02T11:45:00.000Z'],
      ['2026-03-09', 'ev-lunes', '2026-03-09T11:00:00.000Z', '2026-03-09T11:45:00.000Z'],
    ])
  })

  it('recorre fin de mes y de año con los días de la serie (0 = domingo) y sin fin sigue hasta `to`', async () => {
    prismaMock.event.findMany.mockResolvedValue([
      eventRow({
        id: 'ev-finde',
        startDate: new Date('2025-12-01T03:00:00.000Z'),
        startTime: new Date('2025-12-01T13:00:00.000Z'), // 10:00 en Uruguay
        endTime: new Date('2025-12-01T14:30:00.000Z'),
        daysOfWeek: [0, 6],
      }),
    ])

    const instances = await getPlannedInstances({ from: '2025-12-26', to: '2026-01-04' })

    expect(instances.map(summary)).toEqual([
      ['2025-12-27', 'ev-finde', '2025-12-27T13:00:00.000Z', '2025-12-27T14:30:00.000Z'],
      ['2025-12-28', 'ev-finde', '2025-12-28T13:00:00.000Z', '2025-12-28T14:30:00.000Z'],
      ['2026-01-03', 'ev-finde', '2026-01-03T13:00:00.000Z', '2026-01-03T14:30:00.000Z'],
      ['2026-01-04', 'ev-finde', '2026-01-04T13:00:00.000Z', '2026-01-04T14:30:00.000Z'],
    ])
  })

  it('la vigencia de cada versión y el fin de la serie son inclusivos', async () => {
    prismaMock.event.findMany.mockResolvedValue([
      // Martes y miércoles a las 8:00 hasta el martes 30/6; desde el miércoles 1/7, a las 9:00.
      eventRow({
        id: 'ev-v1',
        startTime: new Date('2026-03-03T11:00:00.000Z'),
        endTime: new Date('2026-03-03T11:45:00.000Z'),
        daysOfWeek: [2, 3],
        effectiveUntil: new Date('2026-06-30T03:00:00.000Z'),
      }),
      eventRow({
        id: 'ev-v2',
        startTime: new Date('2026-03-03T12:00:00.000Z'),
        endTime: new Date('2026-03-03T12:45:00.000Z'),
        daysOfWeek: [2, 3],
        effectiveFrom: new Date('2026-07-01T03:00:00.000Z'),
        recurrenceEnd: new Date('2026-07-08T02:59:59.999Z'), // fin del martes 7/7 en Uruguay
        revisionOf: 'ev-v1',
      }),
    ])

    const instances = await getPlannedInstances({ from: '2026-06-29', to: '2026-07-10' })

    expect(instances.map(summary)).toEqual([
      ['2026-06-30', 'ev-v1', '2026-06-30T11:00:00.000Z', '2026-06-30T11:45:00.000Z'],
      ['2026-07-01', 'ev-v2', '2026-07-01T12:00:00.000Z', '2026-07-01T12:45:00.000Z'],
      ['2026-07-07', 'ev-v2', '2026-07-07T12:00:00.000Z', '2026-07-07T12:45:00.000Z'],
    ])
  })

  it('un evento único fuera de la vigencia de su versión no genera ocurrencia', async () => {
    const reunion = { isRecurring: false, daysOfWeek: [], startDate: new Date('2026-07-01T03:00:00.000Z') }
    prismaMock.event.findMany.mockResolvedValue([
      eventRow({ ...reunion, id: 'ev-vieja', effectiveUntil: new Date('2026-06-30T03:00:00.000Z') }),
      eventRow({ ...reunion, id: 'ev-nueva', effectiveFrom: new Date('2026-07-01T03:00:00.000Z') }),
    ])

    const instances = await getPlannedInstances({ from: '2026-06-28', to: '2026-07-03' })

    expect(instances.map((i) => [i.plannedDate, i.eventId, i.isRecurringInstance])).toEqual([['2026-07-01', 'ev-nueva', false]])
  })
})

function eventRow(overrides: Record<string, unknown>) {
  return {
    id: 'ev',
    title: 'Clase',
    type: 'CLASE',
    status: 'SCHEDULED',
    startDate: new Date('2026-03-02T03:00:00.000Z'),
    startTime: new Date('2026-03-02T11:00:00.000Z'), // 8:00 en Uruguay
    endTime: new Date('2026-03-02T11:45:00.000Z'),
    isRecurring: true,
    recurrenceEnd: null,
    daysOfWeek: [1],
    effectiveFrom: null,
    effectiveUntil: null,
    assignedUserId: 'teacher-1',
    courseOfferingId: null,
    courseOffering: null,
    subject: null,
    ...overrides,
  }
}

function summary(instance: Awaited<ReturnType<typeof getPlannedInstances>>[number]) {
  return [
    instance.plannedDate,
    instance.eventId,
    instance.plannedStartTime?.toISOString(),
    instance.plannedEndTime?.toISOString(),
  ]
}

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
