import { describe, expect, it } from 'vitest'
import { getRiskScoreBadgeClass } from './analytics-display'

describe('getRiskScoreBadgeClass', () => {
  it('rojo para puntaje alto, ámbar medio, verde bajo', () => {
    expect(getRiskScoreBadgeClass(9)).toContain('red')
    expect(getRiskScoreBadgeClass(8)).toContain('amber')
    expect(getRiskScoreBadgeClass(4)).toContain('amber')
    expect(getRiskScoreBadgeClass(3)).toContain('emerald')
    expect(getRiskScoreBadgeClass(0)).toContain('emerald')
  })
})
