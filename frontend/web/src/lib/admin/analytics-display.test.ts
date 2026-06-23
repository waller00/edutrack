import { describe, expect, it } from 'vitest'
import { getRiskScoreBadgeClass, resolveSchoolYearDateRange } from './analytics-display'

describe('getRiskScoreBadgeClass', () => {
  it('rojo para puntaje alto, ámbar medio, verde bajo', () => {
    expect(getRiskScoreBadgeClass(9)).toContain('red')
    expect(getRiskScoreBadgeClass(8)).toContain('amber')
    expect(getRiskScoreBadgeClass(4)).toContain('amber')
    expect(getRiskScoreBadgeClass(3)).toContain('emerald')
    expect(getRiskScoreBadgeClass(0)).toContain('emerald')
  })
})

describe('resolveSchoolYearDateRange', () => {
  const TODAY = '2026-06-22'

  it('ciclo cerrado pasado: usa inicio y fin del ciclo', () => {
    expect(resolveSchoolYearDateRange({ startsOn: '2025-03-01', endsOn: '2025-12-15' }, TODAY)).toEqual({
      from: '2025-03-01',
      to: '2025-12-15',
    })
  })

  it('acota el fin a hoy cuando el ciclo termina en el futuro', () => {
    expect(resolveSchoolYearDateRange({ startsOn: '2026-03-01', endsOn: '2026-12-15' }, TODAY)).toEqual({
      from: '2026-03-01',
      to: TODAY,
    })
  })

  it('sin fecha de fin usa hoy como tope', () => {
    expect(resolveSchoolYearDateRange({ startsOn: '2026-03-01', endsOn: null }, TODAY)).toEqual({
      from: '2026-03-01',
      to: TODAY,
    })
  })

  it('normaliza timestamps ISO a YYYY-MM-DD', () => {
    expect(
      resolveSchoolYearDateRange({ startsOn: '2025-03-01T00:00:00.000Z', endsOn: '2025-12-15T03:00:00.000Z' }, TODAY),
    ).toEqual({ from: '2025-03-01', to: '2025-12-15' })
  })

  it('ciclo enteramente futuro: from no supera al tope (hoy)', () => {
    expect(resolveSchoolYearDateRange({ startsOn: '2027-03-01', endsOn: '2027-12-15' }, TODAY)).toEqual({
      from: TODAY,
      to: TODAY,
    })
  })

  it('devuelve null si no hay fecha de inicio', () => {
    expect(resolveSchoolYearDateRange({ startsOn: null, endsOn: '2025-12-15' }, TODAY)).toBeNull()
    expect(resolveSchoolYearDateRange(null, TODAY)).toBeNull()
    expect(resolveSchoolYearDateRange(undefined, TODAY)).toBeNull()
  })
})
