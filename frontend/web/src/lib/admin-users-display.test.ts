import {
  buildAdminUserEditChanges,
  buildAdminUsersQueryParams,
  cloneAdminUser,
  getActiveBadgeClass,
  getActiveLabel,
  getAdminUserSaveErrorMessage,
  getApprovalBadgeClass,
  getApprovalLabel,
  getLockBadgeClass,
  getLockLabel,
  getVerificationBadgeClass,
  getVerificationLabel,
  type AdminUserRow,
} from '@/lib/admin-users-display'

const u = (p: Partial<AdminUserRow> & Pick<AdminUserRow, 'id' | 'email'>): AdminUserRow => ({
  role: 'TEACHER',
  isApproved: true,
  isActive: true,
  ...p,
})

describe('buildAdminUsersQueryParams', () => {
  it('base y filtro rol', () => {
    expect(buildAdminUsersQueryParams('', 'ALL')).toContain('page=1')
    expect(buildAdminUsersQueryParams('ana', 'TEACHER')).toContain('q=ana')
    expect(buildAdminUsersQueryParams('', 'ADMIN')).toContain('role=ADMIN')
  })
})

describe('cloneAdminUser', () => {
  it('copia superficial', () => {
    const a = u({ id: '1', email: 'e@test.com' })
    const b = cloneAdminUser(a)
    expect(b).toEqual(a)
    expect(b).not.toBe(a)
  })
})

describe('buildAdminUserEditChanges', () => {
  it('vacío sin original', () => {
    expect(buildAdminUserEditChanges(null, u({ id: '1', email: 'a' }))).toEqual([])
  })

  it('detecta cambios', () => {
    const orig = u({ id: '1', email: 'a', role: 'STAFF', username: 'x', nationalId: '1' })
    const ed = { ...orig, role: 'TEACHER' as const, username: 'y', nationalId: '2' }
    const c = buildAdminUserEditChanges(orig, ed)
    expect(c.some((x) => x.includes('Rol'))).toBe(true)
    expect(c.some((x) => x.includes('Usuario'))).toBe(true)
    expect(c.some((x) => x.includes('Cédula'))).toBe(true)
  })
})

describe('getAdminUserSaveErrorMessage', () => {
  it('409 400 default', () => {
    expect(getAdminUserSaveErrorMessage({ message: '409' })).toContain('registrados')
    expect(getAdminUserSaveErrorMessage({ message: '400 bad' })).toContain('inválidos')
    expect(getAdminUserSaveErrorMessage({ message: '500' })).toContain('No se pudo')
  })
})

describe('badges y labels', () => {
  it('verificación email', () => {
    expect(getVerificationLabel()).toBe('No verificado')
    expect(getVerificationLabel('2024')).toBe('Verificado')
    expect(getVerificationBadgeClass()).toContain('amber')
    expect(getVerificationBadgeClass('x')).toContain('green')
  })

  it('aprobación activo lock', () => {
    expect(getApprovalLabel(false)).toBe('Pendiente')
    expect(getActiveLabel(false)).toBe('Baja')
    expect(getLockLabel('x')).toBe('Bloqueado')
    expect(getLockBadgeClass()).toContain('slate')
    expect(getApprovalBadgeClass(false)).toContain('amber')
    expect(getActiveBadgeClass(false)).toContain('red')
  })
})
