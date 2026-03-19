import {
  buildAdminEventsAllQueryString,
  getAdminEventRoleTypeOptions,
  getAdminEventStatusLabel,
  getAdminEventStatusStyle,
  getAdminEventTypeLabel,
  getAdminEventsDefaultStartDate,
} from '@/lib/admin-events-display'

const filters = {
  startDate: '2025-01-01',
  endDate: '',
  userId: '',
  assignedUserId: '',
  type: 'CLASE',
  status: 'SCHEDULED',
}

describe('admin-events-display', () => {
  it('labels tipo y estado', () => {
    expect(getAdminEventTypeLabel('CLASE')).toBe('Clase')
    expect(getAdminEventTypeLabel('X')).toBe('X')
    expect(getAdminEventStatusLabel('COMPLETED')).toBe('Completado')
    expect(getAdminEventStatusStyle('CANCELLED')).toContain('red')
  })

  it('opciones por rol', () => {
    expect(getAdminEventRoleTypeOptions('TEACHER')).toHaveLength(2)
    expect(getAdminEventRoleTypeOptions('STAFF')[0].value).toBe('JORNADA_LABORAL')
    expect(getAdminEventRoleTypeOptions('')).toEqual([])
  })

  it('query', () => {
    const q = buildAdminEventsAllQueryString(2, filters)
    expect(q).toContain('page=2')
    expect(q).toContain('type=CLASE')
    expect(getAdminEventsDefaultStartDate(2023)).toBe('2023-01-01')
  })
})
