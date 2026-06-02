import { describe, it, expect } from 'vitest'
import {
  isoToYmd,
  resolveAdminSchoolYearForEvents,
  schoolYearEndYmd,
  schoolYearStartYmd,
  formatYmdEs,
  schoolYearRangeLabel,
} from './event-recurrence'

const year = (over: Record<string, unknown> = {}) =>
  ({ id: 'y1', code: '2026', label: 'Lectivo', startsOn: '2026-03-01T00:00:00Z', endsOn: '2026-12-01T00:00:00Z', ...over } as never)

describe('isoToYmd', () => {
  it('extrae YYYY-MM-DD válido', () => {
    expect(isoToYmd('2026-03-01T10:00:00Z')).toBe('2026-03-01')
  })
  it('null/undefined/vacío → null', () => {
    expect(isoToYmd(null)).toBeNull()
    expect(isoToYmd(undefined)).toBeNull()
    expect(isoToYmd('')).toBeNull()
  })
  it('formato inválido → null', () => {
    expect(isoToYmd('no-fecha')).toBeNull()
  })
})

describe('resolveAdminSchoolYearForEvents', () => {
  it('null ctx → null', () => {
    expect(resolveAdminSchoolYearForEvents(null)).toBeNull()
  })
  it('allYears → null', () => {
    expect(resolveAdminSchoolYearForEvents({ allYears: true, selectedId: 'y1', activeId: null, years: [year()] })).toBeNull()
  })
  it('sin id (selected ni active) → null', () => {
    expect(resolveAdminSchoolYearForEvents({ allYears: false, selectedId: null, activeId: null, years: [year()] })).toBeNull()
  })
  it('usa selectedId y luego activeId', () => {
    expect(resolveAdminSchoolYearForEvents({ allYears: false, selectedId: 'y1', activeId: null, years: [year()] })?.id).toBe('y1')
    expect(resolveAdminSchoolYearForEvents({ allYears: false, selectedId: null, activeId: 'y1', years: [year()] })?.id).toBe('y1')
  })
  it('id sin match en years → null', () => {
    expect(resolveAdminSchoolYearForEvents({ allYears: false, selectedId: 'zzz', activeId: null, years: [year()] })).toBeNull()
  })
})

describe('schoolYear*Ymd', () => {
  it('start/end de un año', () => {
    expect(schoolYearEndYmd(year())).toBe('2026-12-01')
    expect(schoolYearStartYmd(year())).toBe('2026-03-01')
  })
  it('año null → null', () => {
    expect(schoolYearEndYmd(null)).toBeNull()
    expect(schoolYearStartYmd(null)).toBeNull()
  })
})

describe('formatYmdEs', () => {
  it('convierte a dd/mm/yyyy', () => {
    expect(formatYmdEs('2026-03-01')).toBe('01/03/2026')
  })
  it('input mal formado → devuelve igual', () => {
    expect(formatYmdEs('2026')).toBe('2026')
  })
})

describe('schoolYearRangeLabel', () => {
  it('null → genérico', () => {
    expect(schoolYearRangeLabel(null)).toBe('año lectivo seleccionado')
  })
  it('usa code, y label como fallback', () => {
    expect(schoolYearRangeLabel(year())).toBe('año lectivo 2026')
    expect(schoolYearRangeLabel(year({ code: null }))).toBe('año lectivo Lectivo')
  })
})
