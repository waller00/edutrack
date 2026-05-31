import { describe, expect, it } from 'vitest'
import { resolveSubstitutionOccurrence, SubstitutionError } from './substitution-occurrence.js'

describe('resolveSubstitutionOccurrence', () => {
  const baseEvent = {
    startDate: new Date('2026-05-01T12:00:00.000Z'),
    startTime: new Date('1970-01-01T15:00:00.000Z'),
    endTime: new Date('1970-01-01T15:45:00.000Z'),
    isRecurring: true,
    daysOfWeek: [2],
  }

  it('acepta fecha explícita en día recurrente', () => {
    const r = resolveSubstitutionOccurrence({
      occurrenceDate: '2026-05-05',
      event: baseEvent,
    })
    expect(r.occurrenceYmd).toBe('2026-05-05')
    expect(r.startTime.getTime()).toBeLessThan(r.endTime.getTime())
  })

  it('rechaza día que no corresponde a la recurrencia', () => {
    expect(() =>
      resolveSubstitutionOccurrence({
        occurrenceDate: '2026-05-06',
        event: baseEvent,
      }),
    ).toThrow(SubstitutionError)
  })
})
