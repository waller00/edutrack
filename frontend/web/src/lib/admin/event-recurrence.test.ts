import { describe, expect, it } from 'vitest'
import {
  resolveAdminSchoolYearForEvents,
  schoolYearEndYmd,
  schoolYearRangeLabel,
} from './event-recurrence'

const years = [
  {
    id: 'sy-2026',
    code: 2026,
    label: 'Ciclo 2026',
    startsOn: '2026-03-01T12:00:00.000Z',
    endsOn: '2026-12-15T12:00:00.000Z',
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
  },
]

describe('event-recurrence', () => {
  it('resuelve año lectivo seleccionado', () => {
    const year = resolveAdminSchoolYearForEvents({
      allYears: false,
      selectedId: 'sy-2026',
      activeId: 'sy-2026',
      years,
    })
    expect(schoolYearEndYmd(year)).toBe('2026-12-15')
    expect(schoolYearRangeLabel(year)).toContain('2026')
    expect(schoolYearRangeLabel(year)).not.toContain('15/12/2026')
  })

  it('no resuelve año cuando allYears está activo', () => {
    expect(
      resolveAdminSchoolYearForEvents({
        allYears: true,
        selectedId: null,
        activeId: 'sy-2026',
        years,
      }),
    ).toBeNull()
  })
})
