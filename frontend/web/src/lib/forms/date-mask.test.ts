import { describe, expect, it } from 'vitest'
import { dmyToYmd, maskDmy, ymdToDmy } from './date-mask'

describe('date-mask', () => {
  it('formats yyyy-mm-dd as dd/mm/yyyy', () => {
    expect(ymdToDmy('2026-06-24')).toBe('24/06/2026')
    expect(ymdToDmy('2026-6-24')).toBe('')
  })

  it('parses valid dd/mm/yyyy as yyyy-mm-dd', () => {
    expect(dmyToYmd('24/06/2026')).toBe('2026-06-24')
    expect(dmyToYmd('29/02/2024')).toBe('2024-02-29')
  })

  it('rejects incomplete and impossible dates', () => {
    expect(dmyToYmd('24/06/26')).toBe('')
    expect(dmyToYmd('31/02/2026')).toBe('')
    expect(dmyToYmd('29/02/2025')).toBe('')
  })

  it('masks typed digits as dd/mm/yyyy', () => {
    expect(maskDmy('2')).toBe('2')
    expect(maskDmy('2406')).toBe('24/06')
    expect(maskDmy('24062026')).toBe('24/06/2026')
    expect(maskDmy('24-06-2026 extra')).toBe('24/06/2026')
  })
})
