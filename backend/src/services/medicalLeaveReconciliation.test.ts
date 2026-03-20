import { describe, it, expect } from 'vitest'
import { rangesOverlapInstant, licenseCoversInstant } from './medicalLeaveReconciliation.js'

describe('medicalLeaveReconciliation helpers', () => {
  it('rangesOverlapInstant detecta solape', () => {
    const a0 = new Date('2025-06-01T08:00:00.000Z')
    const a1 = new Date('2025-06-01T12:00:00.000Z')
    const b0 = new Date('2025-06-01T10:00:00.000Z')
    const b1 = new Date('2025-06-01T11:00:00.000Z')
    expect(rangesOverlapInstant(a0, a1, b0, b1)).toBe(true)
  })

  it('rangesOverlapInstant sin solape', () => {
    const a0 = new Date('2025-06-01T08:00:00.000Z')
    const a1 = new Date('2025-06-01T09:00:00.000Z')
    const b0 = new Date('2025-06-01T10:00:00.000Z')
    const b1 = new Date('2025-06-01T11:00:00.000Z')
    expect(rangesOverlapInstant(a0, a1, b0, b1)).toBe(false)
  })

  it('licenseCoversInstant inclusivo en bordes', () => {
    const lic = {
      startDate: new Date('2025-06-01T00:00:00.000Z'),
      endDate: new Date('2025-06-05T23:59:59.999Z'),
    }
    expect(licenseCoversInstant(lic, new Date('2025-06-01T00:00:00.000Z'))).toBe(true)
    expect(licenseCoversInstant(lic, new Date('2025-06-05T23:59:59.999Z'))).toBe(true)
  })
})
