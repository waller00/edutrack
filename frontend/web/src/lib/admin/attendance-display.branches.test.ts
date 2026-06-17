import { describe, it, expect } from 'vitest'
import {
  getAdminAttendanceTypeStyle,
  getAdminAttendanceTypeLabel,
  getAdminAttendanceStatusStyle,
  getAdminAttendanceStatusLabel,
  getAdminAttendancePlannedTimeLabel,
  getAdminAttendanceDefaultStartDate,
  buildAdminAttendanceAllQueryString,
  buildAttendanceExportReportQueryString,
  type AdminAttendanceListFilters,
  type AdminAttendanceStatus,
} from './attendance-display'

describe('type style/label', () => {
  it('cubre CHECK_IN / CHECK_OUT / INCIDENT', () => {
    expect(getAdminAttendanceTypeStyle('INCIDENT')).toContain('red')
    expect(getAdminAttendanceTypeStyle('CHECK_IN')).toContain('green')
    expect(getAdminAttendanceTypeStyle('CHECK_OUT')).toContain('red')
    expect(getAdminAttendanceTypeLabel('INCIDENT')).toBe('Incidencia')
    expect(getAdminAttendanceTypeLabel('CHECK_IN')).toBe('Entrada')
    expect(getAdminAttendanceTypeLabel('CHECK_OUT')).toBe('Salida')
  })
})

describe('status style/label (todas las ramas)', () => {
  const all: AdminAttendanceStatus[] = [
    'PRESENT', 'LATE', 'ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'EXIT', 'EARLY_EXIT', 'JUSTIFIED', 'SUBSTITUTED',
  ]
  it('estilo para cada estado y default', () => {
    for (const s of all) expect(typeof getAdminAttendanceStatusStyle(s)).toBe('string')
    expect(getAdminAttendanceStatusStyle('XX' as AdminAttendanceStatus)).toContain('gray')
  })
  it('label para cada estado y default', () => {
    expect(getAdminAttendanceStatusLabel('PRESENT')).toBe('Presente')
    expect(getAdminAttendanceStatusLabel('LATE')).toBe('Tarde')
    expect(getAdminAttendanceStatusLabel('EXIT')).toBe('Salida')
    expect(getAdminAttendanceStatusLabel('EARLY_EXIT')).toBe('Salida Anticipada')
    expect(getAdminAttendanceStatusLabel('ABSENT_NOT_JUSTIFIED')).toContain('No Justificada')
    expect(getAdminAttendanceStatusLabel('ABSENT_JUSTIFIED')).toContain('Justificada')
    expect(getAdminAttendanceStatusLabel('JUSTIFIED')).toBe('Justificado')
    expect(getAdminAttendanceStatusLabel('SUBSTITUTED')).toBe('Suplida')
    expect(getAdminAttendanceStatusLabel('ZZ' as AdminAttendanceStatus)).toBe('ZZ')
  })
})

describe('getAdminAttendancePlannedTimeLabel', () => {
  it('sin evento → N/A', () => {
    expect(getAdminAttendancePlannedTimeLabel({ type: 'CHECK_IN' })).toBe('N/A')
  })
  it('CHECK_IN / INCIDENT usan startTime', () => {
    expect(getAdminAttendancePlannedTimeLabel({ type: 'CHECK_IN', event: { startTime: '2026-03-01T12:00:00Z' } })).toMatch(/^\d{2}:\d{2}$/)
    expect(getAdminAttendancePlannedTimeLabel({ type: 'INCIDENT', event: { startTime: '2026-03-01T12:00:00Z' } })).toMatch(/^\d{2}:\d{2}$/)
  })
  it('CHECK_OUT usa endTime', () => {
    expect(getAdminAttendancePlannedTimeLabel({ type: 'CHECK_OUT', event: { endTime: '2026-03-01T18:00:00Z' } })).toMatch(/^\d{2}:\d{2}$/)
  })
  it('evento sin la hora correspondiente → N/A', () => {
    expect(getAdminAttendancePlannedTimeLabel({ type: 'CHECK_IN', event: {} })).toBe('N/A')
    expect(getAdminAttendancePlannedTimeLabel({ type: 'CHECK_OUT', event: {} })).toBe('N/A')
  })
})

describe('default start date y query strings', () => {
  const empty: AdminAttendanceListFilters = {
    startDate: '', endDate: '', userId: '', eventId: '', eventType: '', type: '', status: '', role: '',
  }
  const full: AdminAttendanceListFilters = {
    startDate: '2026-01-01', endDate: '2026-02-01', userId: 'u', eventId: 'e', eventType: 'CLASE',
    type: 'CHECK_IN', status: 'PRESENT', role: 'TEACHER',
  }
  it('default start date', () => {
    expect(getAdminAttendanceDefaultStartDate(2026)).toBe('2026-01-01')
    expect(getAdminAttendanceDefaultStartDate()).toMatch(/^\d{4}-01-01$/)
  })
  it('list query: vacío y completo', () => {
    expect(buildAdminAttendanceAllQueryString(1, empty)).toBe('page=1&pageSize=20')
    const q = buildAdminAttendanceAllQueryString(3, full)
    expect(q).toContain('page=3')
    expect(q).toContain('role=TEACHER')
    expect(q).toContain('eventType=CLASE')
  })
  it('export query: excel y pdf', () => {
    expect(buildAttendanceExportReportQueryString('excel', empty)).toBe('format=excel')
    const q = buildAttendanceExportReportQueryString('pdf', full)
    expect(q).toContain('format=pdf')
    expect(q).toContain('userId=u')
    expect(q).toContain('status=PRESENT')
  })
})
