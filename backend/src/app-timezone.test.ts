import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import {
  APP_TIMEZONE,
  jsWeekdayInUruguay,
  parseEventTimeToUruguayHhMm,
  parseStartDateToUruguayYmd,
  uruguayStartOfDayFromInstant,
  uruguayWallToUtc,
} from './app-timezone.js'

describe('app-timezone', () => {
  it('uruguayWallToUtc: mediodía uruguayo → UTC+3', () => {
    const d = uruguayWallToUtc('2025-06-15', 12, 0)
    expect(d.toISOString()).toBe('2025-06-15T15:00:00.000Z')
  })

  it('parseStartDateToUruguayYmd con ISO toma el día civil en Uruguay', () => {
    const ymd = parseStartDateToUruguayYmd('2025-12-15T14:00:00.000Z')
    expect(ymd).toBe('2025-12-15')
    const wall = DateTime.fromJSDate(uruguayWallToUtc(ymd!, 10, 0), { zone: 'utc' }).setZone(APP_TIMEZONE)
    expect(wall.hour).toBe(10)
  })

  it('parseEventTimeToUruguayHhMm acepta HH:MM', () => {
    expect(parseEventTimeToUruguayHhMm('9:05')).toEqual({ hh: 9, mm: 5 })
  })

  it('jsWeekdayInUruguay coherente con luxon', () => {
    const d = uruguayWallToUtc('2025-06-04', 10, 0)
    const luxDow = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIMEZONE).weekday % 7
    expect(jsWeekdayInUruguay(d)).toBe(luxDow)
  })

  it('uruguayStartOfDayFromInstant: día civil Uruguay para un instante', () => {
    const utcNoon = new Date('2025-06-15T15:00:00.000Z')
    const start = uruguayStartOfDayFromInstant(utcNoon)
    expect(start.toISOString()).toBe('2025-06-15T03:00:00.000Z')
  })
})
