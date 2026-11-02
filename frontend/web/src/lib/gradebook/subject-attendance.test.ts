import { describe, expect, it } from 'vitest'
import { hasRollCalls, markCountParts } from './subject-attendance'

describe('markCountParts', () => {
  it('nombra cada marca con su número, en singular o plural', () => {
    expect(markCountParts({ absent: 1, justified: 1, late: 1, classes: 9 })).toEqual([
      { count: 1, label: 'sin justificar' },
      { count: 1, label: 'justificada' },
      { count: 1, label: 'llegada tarde' },
    ])
    expect(markCountParts({ absent: 3, justified: 2, late: 4, classes: 20 }).map((part) => part.label)).toEqual([
      'sin justificar',
      'justificadas',
      'llegadas tarde',
    ])
  })

  it('lo que es cero no se nombra', () => {
    expect(markCountParts({ absent: 0, justified: 2, late: 0, classes: 9 })).toEqual([{ count: 2, label: 'justificadas' }])
    expect(markCountParts({ absent: 0, justified: 0, late: 0, classes: 9 })).toEqual([])
  })
})

describe('hasRollCalls', () => {
  it('sólo hay algo que mostrar si se pasó lista con el alumno', () => {
    expect(hasRollCalls({ absent: 0, justified: 0, late: 0, classes: 1 })).toBe(true)
    expect(hasRollCalls({ absent: 0, justified: 0, late: 0, classes: 0 })).toBe(false)
    expect(hasRollCalls(null)).toBe(false)
    expect(hasRollCalls(undefined)).toBe(false)
  })
})
