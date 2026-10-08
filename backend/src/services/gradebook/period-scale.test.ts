import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({ prismaMock: { gradingScale: { findFirst: vi.fn() } } }))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))

import { conductLabel, conductOptions, gradebookScaleRole, isConductValue, periodScaleFor } from './period-scale.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('escala de C y R', () => {
  it('busca la del nivel aunque esté desactivada', async () => {
    prismaMock.gradingScale.findFirst.mockResolvedValueOnce({ code: 'NUMERICA_1_12' })

    await expect(periodScaleFor('EMS')).resolves.toEqual({ code: 'NUMERICA_1_12' })
    expect(prismaMock.gradingScale.findFirst.mock.calls[0][0].where).toEqual({ code: 'NUMERICA_1_12' })
  })

  it('sólo si nunca se sembró cae en la primera activa', async () => {
    prismaMock.gradingScale.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ code: 'OTRA' })

    await expect(periodScaleFor(null)).resolves.toEqual({ code: 'OTRA' })
    expect(prismaMock.gradingScale.findFirst.mock.calls[0][0].where).toEqual({ code: 'NUMERICA_1_10' })
    expect(prismaMock.gradingScale.findFirst.mock.calls[1][0].where).toEqual({ isActive: true })
  })
})

describe('escalas que usa la libreta', () => {
  it('dice para qué usa cada una', () => {
    expect(gradebookScaleRole('NUMERICA_1_10')).toBe('C y R de ciclo básico')
    expect(gradebookScaleRole('NUMERICA_1_12')).toBe('C y R de bachillerato')
    expect(gradebookScaleRole('CONDUCTA')).toBe('la conducta')
    expect(gradebookScaleRole('OTRA')).toBeNull()
  })
})

const LEVELS = [
  { minValueHundredths: 100, maxValueHundredths: 100, label: 'Mala' },
  { minValueHundredths: 200, maxValueHundredths: 200, label: 'Regular' },
  { minValueHundredths: 300, maxValueHundredths: 300, label: 'Buena' },
  { minValueHundredths: 400, maxValueHundredths: 400, label: 'Muy buena' },
]

describe('escala de conducta', () => {
  it('rotula con el tramo de la escala, no con una tabla fija', () => {
    expect(conductLabel(300, LEVELS)).toBe('Buena')
    expect(conductLabel(400, [{ minValueHundredths: 400, maxValueHundredths: 400, label: 'Excelente' }])).toBe('Excelente')
  })

  it('sin nota no hay texto; fuera de la escala muestra el número', () => {
    expect(conductLabel(null, LEVELS)).toBeNull()
    expect(conductLabel(250, LEVELS)).toBe('2,5')
  })

  it('ofrece un valor por tramo y valida contra la escala', () => {
    expect(conductOptions(LEVELS).map((o) => o.valueHundredths)).toEqual([100, 200, 300, 400])
    expect(isConductValue(200, LEVELS)).toBe(true)
    expect(isConductValue(500, LEVELS)).toBe(false)
    expect(isConductValue(null, LEVELS)).toBe(true)
  })
})
