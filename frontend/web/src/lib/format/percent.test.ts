import { describe, expect, it } from 'vitest'
import { formatCount, formatPercent, formatRatio, formatShare, ratioValue } from './percent'

describe('porcentajes de los indicadores', () => {
  it('escribe cantidades y porcentajes como en Uruguay', () => {
    expect(formatCount(1034)).toBe('1.034')
    expect(formatPercent(38.64)).toBe('38,6 %')
    expect(formatPercent(40)).toBe('40 %')
  })

  it('un porcentaje siempre sale de una parte y un total', () => {
    expect(ratioValue(1, 4)).toBe(25)
    expect(formatRatio(1, 3)).toBe('33,3 %')
    expect(formatShare(34, 88)).toBe('34 de 88 (38,6 %)')
  })

  it('sin total no inventa un 0 %', () => {
    expect(ratioValue(0, 0)).toBeNull()
    expect(formatRatio(0, 0)).toBe('—')
    expect(formatShare(0, 0)).toBe('0 de 0')
  })
})
