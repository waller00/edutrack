import { describe, expect, it } from 'vitest'
import {
  formatClockHhMmInUruguayFromIso,
  formatDateInUruguay,
  formatTimeInUruguay,
  isUruguayWallDateTimeInPast,
} from '@/lib/forms/datetime-uy'

describe('datetime-uy', () => {
  it('formatea instante UTC como hora civil Uruguay', () => {
    const t = formatTimeInUruguay('2025-06-15T15:00:00.000Z')
    expect(t).toMatch(/12/)
    expect(t).toMatch(/00/)
  })

  it('formatea fecha en Uruguay', () => {
    expect(formatDateInUruguay('2025-06-15T15:00:00.000Z')).toMatch(/2025/)
    expect(formatDateInUruguay('2025-06-15T15:00:00.000Z')).toMatch(/06/)
    expect(formatDateInUruguay('2025-06-15T15:00:00.000Z')).toMatch(/15/)
  })

  it('ISO → HH:MM para selects (Uruguay)', () => {
    expect(formatClockHhMmInUruguayFromIso('2025-06-15T15:00:00.000Z')).toBe('12:00')
  })

  it('HH:MM pasa sin T', () => {
    expect(formatClockHhMmInUruguayFromIso('9:05')).toBe('09:05')
  })

  it('detecta fecha/hora civil Uruguay en el pasado', () => {
    const ref = new Date('2026-06-15T15:00:00.000Z') // 12:00 Uruguay
    expect(isUruguayWallDateTimeInPast('2026-06-15', '11:00', ref)).toBe(true)
    expect(isUruguayWallDateTimeInPast('2026-06-15', '12:00', ref)).toBe(false)
    expect(isUruguayWallDateTimeInPast('2026-06-16', '08:00', ref)).toBe(false)
  })
})
