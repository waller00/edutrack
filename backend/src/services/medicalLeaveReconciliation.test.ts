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

  it('licenseCoversInstant cubre los días enteros en hora de Uruguay', () => {
    // Como la guarda la pantalla: el mediodía UTC de cada día (las 9:00 en Uruguay).
    const lic = {
      startDate: new Date('2025-06-02T12:00:00.000Z'),
      endDate: new Date('2025-06-06T12:00:00.000Z'),
    }
    // Una clase de las 7:30 del primer día (10:30 UTC) y una de las 19:00 del último (22:00 UTC).
    // Antes quedaban afuera: la licencia iba de las 9:00 del 2 a las 9:00 del 6.
    expect(licenseCoversInstant(lic, new Date('2025-06-02T10:30:00.000Z'))).toBe(true)
    expect(licenseCoversInstant(lic, new Date('2025-06-06T22:00:00.000Z'))).toBe(true)
    // El día anterior y el siguiente, no.
    expect(licenseCoversInstant(lic, new Date('2025-06-02T02:59:00.000Z'))).toBe(false)
    expect(licenseCoversInstant(lic, new Date('2025-06-07T03:00:00.000Z'))).toBe(false)
  })

  it('una licencia vieja guardada a medianoche UTC cubre el mismo día', () => {
    const lic = {
      startDate: new Date('2025-06-02T00:00:00.000Z'),
      endDate: new Date('2025-06-02T00:00:00.000Z'),
    }
    expect(licenseCoversInstant(lic, new Date('2025-06-02T20:00:00.000Z'))).toBe(true)
    // El 1/6 a las 21:00 de Uruguay es 00:00 UTC del 2: no es el día de la licencia.
    expect(licenseCoversInstant(lic, new Date('2025-06-02T00:00:00.000Z'))).toBe(false)
  })
})
