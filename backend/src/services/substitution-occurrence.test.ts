import { describe, expect, it } from 'vitest'
import {
  resolveSubstitutionOccurrence,
  SubstitutionError,
  combineDateWithUtcTime,
  jsWeekdayInUruguayYmd,
} from './substitution-occurrence.js'

describe('helpers de substitution-occurrence', () => {
  it('combineDateWithUtcTime: combina fecha + hora UTC', () => {
    const r = combineDateWithUtcTime('2026-05-05', new Date('1970-01-01T15:30:45.000Z'))
    expect(r.toISOString()).toBe('2026-05-05T15:30:45.000Z')
  })

  it('jsWeekdayInUruguayYmd: 0=domingo … 6=sábado', () => {
    expect(jsWeekdayInUruguayYmd('2026-05-03')).toBe(0)
    expect(jsWeekdayInUruguayYmd('2026-05-05')).toBe(2)
    expect(jsWeekdayInUruguayYmd('2026-05-09')).toBe(6)
  })
})

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
