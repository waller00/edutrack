import { describe, expect, it } from 'vitest'
import { licenseDays, licenseTiming, licenseTimingText, overlapDays, sortLicenses } from './licenses'

const lic = (startDate: string, endDate: string) => ({ startDate: `${startDate}T12:00:00.000Z`, endDate: `${endDate}T12:00:00.000Z` })

describe('las licencias en días', () => {
  it('cuenta el primero y el último', () => {
    expect(licenseDays(lic('2026-11-02', '2026-11-06'))).toBe(5)
    expect(licenseDays(lic('2026-11-02', '2026-11-02'))).toBe(1)
  })

  it('vigente hoy, por empezar o pasada', () => {
    expect(licenseTiming(lic('2026-11-02', '2026-11-06'), '2026-11-04')).toBe('CURRENT')
    expect(licenseTimingText(lic('2026-11-02', '2026-11-06'), '2026-11-04')).toBe('Vigente hoy')
    expect(licenseTimingText(lic('2026-11-12', '2026-11-13'), '2026-11-04')).toBe('Empieza el 12/11')
    expect(licenseTimingText(lic('2026-10-01', '2026-10-02'), '2026-11-04')).toBeNull()
  })

  it('los días que caen en un período', () => {
    expect(overlapDays(lic('2026-02-25', '2026-03-04'), '2026-03-02', '2026-12-15')).toBe(3)
    expect(overlapDays(lic('2026-01-10', '2026-01-12'), '2026-03-02', '2026-12-15')).toBe(0)
  })

  it('primero la vigente, después las que vienen y las pasadas, la más nueva primero', () => {
    const rows = [lic('2026-05-01', '2026-05-02'), lic('2026-11-20', '2026-11-21'), lic('2026-11-03', '2026-11-05'), lic('2026-08-01', '2026-08-01')]
    expect(sortLicenses(rows, '2026-11-04').map((l) => l.startDate.slice(0, 10))).toEqual(['2026-11-03', '2026-11-20', '2026-08-01', '2026-05-01'])
  })
})
