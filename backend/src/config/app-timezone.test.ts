import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DateTime } from 'luxon'
import {
  getAppTimezone,
  jsWeekdayInUruguay,
  parseEventTimeToUruguayHhMm,
  parseStartDateToUruguayYmd,
  uruguayYmdEndOfDayToUtc,
  uruguayStartOfDayFromInstant,
  uruguayWallToUtc,
} from './app-timezone.js'
import { resetInstitutionTimezoneForTests, setInstitutionTimezoneForTests } from './institution-timezone.js'

describe('app-timezone', () => {
  beforeEach(() => {
    setInstitutionTimezoneForTests('America/Montevideo')
  })

  afterEach(() => {
    resetInstitutionTimezoneForTests()
  })

  it('getAppTimezone refleja la zona institucional cacheada', () => {
    expect(getAppTimezone()).toBe('America/Montevideo')
    setInstitutionTimezoneForTests('America/Santiago')
    expect(getAppTimezone()).toBe('America/Santiago')
  })
  it('uruguayWallToUtc: mediodía uruguayo → UTC+3', () => {
    const d = uruguayWallToUtc('2025-06-15', 12, 0)
    expect(d.toISOString()).toBe('2025-06-15T15:00:00.000Z')
  })

  it('parseStartDateToUruguayYmd con ISO toma el día civil en Uruguay', () => {
    const ymd = parseStartDateToUruguayYmd('2025-12-15T14:00:00.000Z')
    expect(ymd).toBe('2025-12-15')
    const wall = DateTime.fromJSDate(uruguayWallToUtc(ymd!, 10, 0), { zone: 'utc' }).setZone(getAppTimezone())
    expect(wall.hour).toBe(10)
  })

  it('parseEventTimeToUruguayHhMm acepta HH:MM', () => {
    expect(parseEventTimeToUruguayHhMm('9:05')).toEqual({ hh: 9, mm: 5 })
  })

  it('parseEventTimeToUruguayHhMm rechaza horas inválidas', () => {
    expect(parseEventTimeToUruguayHhMm('24:00')).toBeNull()
    expect(parseEventTimeToUruguayHhMm('no-es-hora')).toBeNull()
  })

  it('parseStartDateToUruguayYmd acepta YYYY-MM-DD y rechaza fechas inválidas', () => {
    expect(parseStartDateToUruguayYmd('2025-06-15')).toBe('2025-06-15')
    expect(parseStartDateToUruguayYmd('no-es-fecha')).toBeNull()
  })

  it('uruguayYmdEndOfDayToUtc devuelve el cierre del día civil uruguayo', () => {
    expect(uruguayYmdEndOfDayToUtc('2025-06-15').toISOString()).toBe('2025-06-16T02:59:59.999Z')
  })

  it('jsWeekdayInUruguay coherente con luxon', () => {
    const d = uruguayWallToUtc('2025-06-04', 10, 0)
    const luxDow = DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone()).weekday % 7
    expect(jsWeekdayInUruguay(d)).toBe(luxDow)
  })

  it('uruguayStartOfDayFromInstant: día civil Uruguay para un instante', () => {
    const utcNoon = new Date('2025-06-15T15:00:00.000Z')
    const start = uruguayStartOfDayFromInstant(utcNoon)
    expect(start.toISOString()).toBe('2025-06-15T03:00:00.000Z')
  })
})
