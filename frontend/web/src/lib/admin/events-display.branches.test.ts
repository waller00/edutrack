import { describe, it, expect } from 'vitest'
import {
  getAdminEventTypeLabel,
  getAdminEventStatusStyle,
  getAdminEventStatusLabel,
  getAdminEventRoleTypeOptions,
  getAdminEventsDefaultStartDate,
  buildAdminEventsAllQueryString,
  type AdminEventsListFilters,
} from './events-display'

describe('getAdminEventTypeLabel', () => {
  it('cubre todos los tipos y el default', () => {
    expect(getAdminEventTypeLabel('JORNADA_LABORAL')).toBe('Jornada laboral')
    expect(getAdminEventTypeLabel('REUNION')).toBe('Reunión')
    expect(getAdminEventTypeLabel('CLASE')).toBe('Clase')
    expect(getAdminEventTypeLabel('LEGACY')).toBe('LEGACY')
  })
})

describe('getAdminEventStatusStyle / Label', () => {
  const statuses = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'OTRO']
  it('estilo por estado + default', () => {
    for (const s of statuses) expect(typeof getAdminEventStatusStyle(s)).toBe('string')
    expect(getAdminEventStatusStyle('OTRO')).toContain('gray')
  })
  it('label por estado + default', () => {
    expect(getAdminEventStatusLabel('SCHEDULED')).toBe('Programado')
    expect(getAdminEventStatusLabel('IN_PROGRESS')).toBe('En curso')
    expect(getAdminEventStatusLabel('COMPLETED')).toBe('Completado')
    expect(getAdminEventStatusLabel('EXPIRED')).toBe('Vencido')
    expect(getAdminEventStatusLabel('CANCELLED')).toBe('Cancelado')
    expect(getAdminEventStatusLabel('RARO')).toBe('RARO')
  })
})

describe('getAdminEventRoleTypeOptions', () => {
  it('TEACHER, STAFF y vacío', () => {
    expect(getAdminEventRoleTypeOptions('TEACHER').map((o) => o.value)).toEqual(['CLASE', 'REUNION'])
    expect(getAdminEventRoleTypeOptions('STAFF').map((o) => o.value)).toEqual(['JORNADA_LABORAL', 'REUNION'])
    expect(getAdminEventRoleTypeOptions('')).toEqual([])
  })
})

describe('getAdminEventsDefaultStartDate', () => {
  it('usa el año dado o el actual', () => {
    expect(getAdminEventsDefaultStartDate(2026)).toBe('2026-01-01')
    expect(getAdminEventsDefaultStartDate()).toMatch(/^\d{4}-01-01$/)
  })
})

describe('buildAdminEventsAllQueryString', () => {
  const empty: AdminEventsListFilters = {
    startDate: '', endDate: '', userId: '', assignedUserId: '', courseId: '', type: '', status: '',
  }
  it('solo page y pageSize cuando todo vacío', () => {
    expect(buildAdminEventsAllQueryString(2, empty)).toBe('page=2&pageSize=20')
  })
  it('incluye todos los filtros provistos', () => {
    const q = buildAdminEventsAllQueryString(1, {
      startDate: '2026-01-01', endDate: '2026-02-01', userId: 'u', assignedUserId: 'a',
      courseId: 'c', type: 'CLASE', status: 'SCHEDULED',
    })
    expect(q).toContain('startDate=2026-01-01')
    expect(q).toContain('assignedUserId=a')
    expect(q).toContain('type=CLASE')
    expect(q).toContain('status=SCHEDULED')
  })
  it('allYears tiene prioridad sobre schoolYearId', () => {
    expect(buildAdminEventsAllQueryString(1, empty, { allYears: true, schoolYearId: 'sy' })).toContain('allYears=1')
    expect(buildAdminEventsAllQueryString(1, empty, { schoolYearId: 'sy' })).toContain('schoolYearId=sy')
  })
})
