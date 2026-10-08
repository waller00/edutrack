import { describe, expect, it, vi } from 'vitest'

vi.mock('../../db/prisma.js', () => ({ prisma: {} }))

import { conductLabel, conductOptions, isConductValue } from './period-scale.js'

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
