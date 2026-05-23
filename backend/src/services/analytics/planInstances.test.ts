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
})
