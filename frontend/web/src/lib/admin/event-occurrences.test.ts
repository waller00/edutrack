import { describe, it, expect } from 'vitest'
import {
  addDaysToYmd,
  eventOccursOnYmd,
  getOccurrencesForYmd,
  type OccurrenceEvent,
} from './event-occurrences'

const dailyEvent: OccurrenceEvent = {
  id: 'd1',
  title: 'Clase diaria',
  startDate: '2026-01-01T11:00:00.000Z',
  startTime: '2026-01-01T11:00:00.000Z',
  endTime: '2026-01-01T12:00:00.000Z',
  isRecurring: true,
  recurrenceType: 'DAILY',
  daysOfWeek: [],
  recurrenceEnd: '2026-12-31T00:00:00.000Z',
  status: 'SCHEDULED',
}

const singleEvent: OccurrenceEvent = {
  id: 's1',
  title: 'Reunión única',
  startDate: '2026-06-10T13:00:00.000Z',
  startTime: '2026-06-10T13:00:00.000Z',
  endTime: '2026-06-10T14:00:00.000Z',
  isRecurring: false,
  recurrenceType: 'NONE',
  daysOfWeek: [],
  status: 'SCHEDULED',
}

describe('eventOccursOnYmd', () => {
  it('evento diario ocurre dentro del rango y no antes del inicio', () => {
    expect(eventOccursOnYmd(dailyEvent, '2026-06-15')).toBe(true)
    expect(eventOccursOnYmd(dailyEvent, '2025-12-31')).toBe(false)
    expect(eventOccursOnYmd(dailyEvent, '2027-01-01')).toBe(false)
  })

  it('evento único ocurre solo en su fecha', () => {
    expect(eventOccursOnYmd(singleEvent, '2026-06-10')).toBe(true)
    expect(eventOccursOnYmd(singleEvent, '2026-06-11')).toBe(false)
  })
})

describe('addDaysToYmd', () => {
  it('suma y resta días respetando el cambio de mes', () => {
    expect(addDaysToYmd('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDaysToYmd('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('getOccurrencesForYmd con excepciones (childEvents)', () => {
  it('marca como suspendida una ocurrencia con excepción CANCELLED', () => {
    const withCancel: OccurrenceEvent = {
      ...dailyEvent,
      childEvents: [{ startDate: '2026-06-15T11:00:00.000Z', status: 'CANCELLED' }],
    }
    const occ = getOccurrencesForYmd([withCancel], '2026-06-15')
    expect(occ).toHaveLength(1)
    expect(occ[0].suspended).toBe(true)
    // Otro día de la serie sigue normal.
    expect(getOccurrencesForYmd([withCancel], '2026-06-16')[0].suspended).toBe(false)
  })

  it('aplica el override de una excepción (título/horario)', () => {
    const withOverride: OccurrenceEvent = {
      ...dailyEvent,
      childEvents: [
        {
          startDate: '2026-06-15T11:00:00.000Z',
          status: 'SCHEDULED',
          title: 'Clase movida',
          startTime: '2026-06-15T15:00:00.000Z',
          endTime: '2026-06-15T16:00:00.000Z',
        },
      ],
    }
    const occ = getOccurrencesForYmd([withOverride], '2026-06-15')[0]
    expect(occ.overridden).toBe(true)
    expect(occ.suspended).toBe(false)
    expect(occ.title).toBe('Clase movida')
    expect(occ.startTime).toBe('2026-06-15T15:00:00.000Z')
  })
})
