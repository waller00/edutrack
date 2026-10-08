import { beforeEach, describe, expect, it, vi } from 'vitest'

const { activeYearMock, provisionMock } = vi.hoisted(() => ({
  activeYearMock: vi.fn(),
  provisionMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: {} }))
vi.mock('../school-year-service.js', () => ({ getActiveSchoolYearId: activeYearMock }))
vi.mock('./provision.js', () => ({ provisionGradeBooks: provisionMock }))

import { provisionActiveSchoolYear, provisionLogLine } from './provision-scheduler.js'

const summary = (over: Record<string, number> = {}) => ({
  schoolYearId: 'sy-1',
  created: 0,
  updated: 0,
  unchanged: 12,
  skippedEvents: 0,
  skippedNotOffered: 0,
  ...over,
})

describe('provisión automática de libretas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('genera las libretas del ciclo activo', async () => {
    activeYearMock.mockResolvedValue('sy-1')
    provisionMock.mockResolvedValue(summary({ created: 3 }))

    expect(await provisionActiveSchoolYear()).toMatchObject({ created: 3 })
    expect(provisionMock).toHaveBeenCalledWith('sy-1')
  })

  it('sin ciclo activo no hace nada', async () => {
    activeYearMock.mockResolvedValue(null)
    expect(await provisionActiveSchoolYear()).toBeNull()
    expect(provisionMock).not.toHaveBeenCalled()
  })

  it('sólo deja log cuando algo cambió', () => {
    expect(provisionLogLine(summary())).toBeNull()
    expect(provisionLogLine(null)).toBeNull()
    expect(provisionLogLine(summary({ created: 2, skippedEvents: 1 }))).toBe(
      '[libreta] provisión: creadas=2 titular-actualizado=0 eventos-sin-mapear=1 cursos-no-ofertados=0',
    )
  })
})
