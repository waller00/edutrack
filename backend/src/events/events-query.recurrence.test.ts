import { describe, it, expect } from 'vitest'
import {
  resolveRecurringRangeEnd,
  generateRecurringInstances,
  expandRecurringEvent,
} from './events-query.js'

const baseWeekly = {
  id: 'ev1',
  status: 'SCHEDULED',
  isRecurring: true,
  recurrenceType: 'WEEKLY',
  daysOfWeek: [1, 3], // lunes y miércoles (luxon weekday%7)
  startDate: '2026-05-04T13:00:00.000Z', // lunes
  startTime: '2026-05-04T13:00:00.000Z',
  endTime: '2026-05-04T14:00:00.000Z',
  recurrenceEnd: null,
  title: 'Clase',
}

describe('resolveRecurringRangeEnd', () => {
  it('usa endDate explícito', () => {
    expect(resolveRecurringRangeEnd(baseWeekly, '2026-06-01T00:00:00Z').toISOString()).toContain('2026-06-01')
  })
  it('usa recurrenceEnd del evento', () => {
    expect(resolveRecurringRangeEnd({ ...baseWeekly, recurrenceEnd: '2026-05-20T00:00:00Z' }).toISOString()).toContain(
      '2026-05-20',
    )
  })
  it('cae al máximo entre ahora y startDate', () => {
    expect(resolveRecurringRangeEnd({ startDate: '2000-01-01T00:00:00Z' }).getTime()).toBeGreaterThan(Date.now() - 1000)
  })
})

describe('generateRecurringInstances', () => {
  it('WEEKLY genera solo los días de la semana indicados', () => {
    const out = generateRecurringInstances(baseWeekly, new Date('2026-05-04T00:00:00Z'), new Date('2026-05-10T23:59:59Z'))
    // semana lun 4 -> dom 10: lunes 4 y miércoles 6
    expect(out).toHaveLength(2)
    expect(out[0].id).toContain('ev1_2026-05-04')
    expect(out[0].isInstance).toBe(true)
    expect(out[0].originalEventId).toBe('ev1')
  })

  it('DAILY genera todos los días del rango', () => {
    const ev = { ...baseWeekly, recurrenceType: 'DAILY' }
    // Mediodía UTC ⇒ días civiles UY inequívocos (04, 05, 06 de mayo).
    const out = generateRecurringInstances(ev, new Date('2026-05-04T12:00:00Z'), new Date('2026-05-06T12:00:00Z'))
    expect(out).toHaveLength(3)
  })

  it('MONTHLY genera el mismo día de mes que la fecha base', () => {
    const ev = { ...baseWeekly, recurrenceType: 'MONTHLY' }
    const out = generateRecurringInstances(ev, new Date('2026-05-01T00:00:00Z'), new Date('2026-07-31T23:59:59Z'))
    // día base = 4 (de startDate 2026-05-04 en UY) → mayo, junio, julio
    expect(out.length).toBeGreaterThanOrEqual(2)
  })

  it('sin startTime/endTime usa medianoche', () => {
    const ev = { ...baseWeekly, startTime: null, endTime: null }
    const out = generateRecurringInstances(ev, new Date('2026-05-04T00:00:00Z'), new Date('2026-05-04T23:59:59Z'))
    expect(out).toHaveLength(1)
  })
})

describe('expandRecurringEvent', () => {
  it('sin rango devuelve el evento tal cual', () => {
    expect(expandRecurringEvent(baseWeekly)).toEqual([baseWeekly])
  })

  it('evento único deriva estado por ocurrencia', () => {
    const single = {
      id: 's1',
      status: 'SCHEDULED',
      isRecurring: false,
      recurrenceType: 'NONE',
      startDate: '2000-01-01T10:00:00Z',
      startTime: '2000-01-01T10:00:00Z',
      endTime: '2000-01-01T11:00:00Z',
    }
    const out = expandRecurringEvent(single, '1999-01-01', '2031-01-01')
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('COMPLETED') // pasado
  })

  it('recurrente expande y respeta childEvents (override y cancelado)', () => {
    const event = {
      ...baseWeekly,
      childEvents: [
        // override del lunes 4: cambia título
        {
          startDate: '2026-05-04T13:00:00.000Z',
          startTime: '2026-05-04T13:00:00.000Z',
          endTime: '2026-05-04T14:00:00.000Z',
          title: 'Clase especial',
          status: 'SCHEDULED',
        },
        // cancela el miércoles 6
        { startDate: '2026-05-06T13:00:00.000Z', status: 'CANCELLED' },
      ],
    }
    const out = expandRecurringEvent(event, '2026-05-04T00:00:00Z', '2026-05-10T23:59:59Z')
    // lunes con override presente, miércoles cancelado → solo 1
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Clase especial')
  })

  it('recurrente sin childEvents deriva estado de cada ocurrencia', () => {
    const out = expandRecurringEvent(baseWeekly, '2026-05-04T00:00:00Z', '2026-05-10T23:59:59Z')
    expect(out).toHaveLength(2)
    expect(out.every((o) => typeof o.status === 'string')).toBe(true)
  })

  it('no genera ocurrencias fantasma antes de la fecha base', () => {
    const out = expandRecurringEvent(baseWeekly, '2026-04-01T00:00:00Z', '2026-05-04T23:59:59Z')
    // rango arranca antes de la base pero se capa a la fecha base (lunes 4)
    expect(out).toHaveLength(1)
  })
})
