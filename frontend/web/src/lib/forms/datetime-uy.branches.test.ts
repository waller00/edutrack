import { describe, it, expect } from 'vitest'
import {
  formatDateInUruguay,
  formatTimeInUruguay,
  getTodayYmdInUruguay,
  formatClockHhMmInUruguayFromIso,
} from './datetime-uy'

describe('formatDateInUruguay / formatTimeInUruguay', () => {
  it('formatea fecha y hora desde ISO y desde Date', () => {
    expect(formatDateInUruguay('2026-03-01T12:00:00Z')).toMatch(/01\/03\/2026/)
    expect(formatTimeInUruguay(new Date('2026-03-01T12:00:00Z'))).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('getTodayYmdInUruguay', () => {
  it('devuelve YYYY-MM-DD para una referencia dada', () => {
    expect(getTodayYmdInUruguay(new Date('2026-03-01T12:00:00Z'))).toBe('2026-03-01')
  })
})

describe('formatClockHhMmInUruguayFromIso', () => {
  it('vacío → default 09:00', () => {
    expect(formatClockHhMmInUruguayFromIso(undefined)).toBe('09:00')
    expect(formatClockHhMmInUruguayFromIso('')).toBe('09:00')
  })
  it('HH:MM normaliza con padding', () => {
    expect(formatClockHhMmInUruguayFromIso('9:05')).toBe('09:05')
    expect(formatClockHhMmInUruguayFromIso('23:59')).toBe('23:59')
  })
  it('HH:MM inválido → default', () => {
    expect(formatClockHhMmInUruguayFromIso('99:99')).toBe('09:00')
  })
  it('ISO con T → proyecta hora a Uruguay', () => {
    expect(formatClockHhMmInUruguayFromIso('2026-03-01T12:00:00Z')).toMatch(/^\d{2}:\d{2}$/)
  })
})
