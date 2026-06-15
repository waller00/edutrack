import {
  ADMIN_USERS_PAGE_SIZE,
  buildAdminUserEditChanges,
  buildAdminUsersQueryParams,
  cloneAdminUser,
  countActiveUserFilters,
  type AdminUsersListFilters,
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
} from '@/lib/admin/users-display'

const u = (p: Partial<AdminUserRow> & Pick<AdminUserRow, 'id' | 'email'>): AdminUserRow => ({
  role: 'TEACHER',
  isApproved: true,
  isActive: true,
  ...p,
})

const baseFilters = (over?: Partial<AdminUsersListFilters>): AdminUsersListFilters => ({
  q: '',
  role: 'ALL',
  approved: '',
  active: '',
  verified: '',
  locked: '',
  docExpiring: '',
  page: 1,
  ...over,
})

describe('buildAdminUsersQueryParams', () => {
  it('base y filtro rol', () => {
    expect(buildAdminUsersQueryParams(baseFilters())).toContain('page=1')
    expect(buildAdminUsersQueryParams(baseFilters())).toContain(`pageSize=${ADMIN_USERS_PAGE_SIZE}`)
    expect(buildAdminUsersQueryParams(baseFilters({ q: 'ana', role: 'TEACHER' }))).toContain('q=ana')
    expect(buildAdminUsersQueryParams(baseFilters({ role: 'STAFF' }))).toContain('role=STAFF')
  })

  it('filtros extended', () => {
    const qs = buildAdminUsersQueryParams(
      baseFilters({
        approved: 'false',
        active: 'true',
        verified: 'true',
        locked: 'false',
      }),
    )
    expect(qs).toContain('approved=false')
    expect(qs).toContain('active=true')
    expect(qs).toContain('verified=true')
    expect(qs).toContain('locked=false')
    expect(qs).not.toContain('docExpiring')
  })

  it('incluye docExpiring solo cuando es true', () => {
    expect(buildAdminUsersQueryParams(baseFilters({ docExpiring: 'true' }))).toContain('docExpiring=true')
    expect(buildAdminUsersQueryParams(baseFilters({ docExpiring: 'false' }))).not.toContain('docExpiring')
  })
})

describe('countActiveUserFilters', () => {
  it('cuenta filtros activos e ignora paginación y valores por defecto', () => {
    expect(countActiveUserFilters(baseFilters())).toBe(0)
    expect(countActiveUserFilters(baseFilters({ page: 5 }))).toBe(0)
    expect(countActiveUserFilters(baseFilters({ role: 'ALL' }))).toBe(0)
    expect(
      countActiveUserFilters(
        baseFilters({ q: 'ana', role: 'TEACHER', approved: 'false', locked: 'true', docExpiring: 'true' }),
      ),
    ).toBe(5)
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
    const ed = { ...orig, role: 'TEACHER', username: 'y', nationalId: '2' }
    const c = buildAdminUserEditChanges(orig, ed)
    expect(c.some((x) => x.includes('Rol'))).toBe(true)
    expect(c.some((x) => x.includes('Usuario'))).toBe(true)
    expect(c.some((x) => x.includes('Cédula'))).toBe(true)
  })

  it('detecta cambios de nombre, apellido, documento, aprobación y estado', () => {
    const orig = u({
      id: '1',
      email: 'a',
      firstName: 'Ana',
      lastName: 'G',
      nationalIdDocumentExpiresAt: '2030-01-01',
      isApproved: false,
      isActive: false,
    })
    const ed = {
      ...orig,
      firstName: 'Beatriz',
      lastName: 'P',
      nationalIdDocumentExpiresAt: '2031-02-02',
      isApproved: true,
      isActive: true,
    }
    const c = buildAdminUserEditChanges(orig, ed)
    expect(c.some((x) => x.includes('Nombre'))).toBe(true)
    expect(c.some((x) => x.includes('Apellido'))).toBe(true)
    expect(c.some((x) => x.includes('Venc. documento'))).toBe(true)
    expect(c.some((x) => x.includes('Aprobación'))).toBe(true)
    expect(c.some((x) => x.includes('Estado'))).toBe(true)
  })
})

describe('getLockLabel', () => {
  it('sin bloqueo / bloqueado con fecha / bloqueado sin fecha válida', () => {
    expect(getLockLabel(null)).toBe('Sin bloqueo')
    const future = new Date(Date.now() + 3_600_000).toISOString()
    expect(getLockLabel(future)).toContain('Bloqueado hasta')
    // fecha inválida pero "bloqueado": año lejano para que isAccountLocked sea true
    expect(getLockLabel('9999-12-31T00:00:00.000Z')).toContain('Bloqueado')
  })
})

describe('getAdminUserSaveErrorMessage', () => {
  it('prioriza mensaje del API y mapea códigos', () => {
    expect(
      getAdminUserSaveErrorMessage({
        status: 409,
        message: 'Esa cédula ya está asignada a otro usuario.',
        data: { message: 'Esa cédula ya está asignada a otro usuario.' },
      }),
    ).toContain('cédula ya está asignada')
    expect(getAdminUserSaveErrorMessage({ status: 409, message: 'API 409' })).toContain('registrados')
    expect(getAdminUserSaveErrorMessage({ status: 400, message: 'API 400' })).toContain('inválidos')
    expect(getAdminUserSaveErrorMessage({ status: 403, message: 'API 403' })).toContain('permiso')
    expect(getAdminUserSaveErrorMessage({ message: '500' })).toContain('No se pudo')
  })
})

describe('badges y labels', () => {
  it('verificación email', () => {
    expect(getVerificationLabel()).toBe('Sin verificar')
    expect(getVerificationLabel('2024')).toBe('Verificado')
    expect(getVerificationBadgeClass()).toContain('amber')
    expect(getVerificationBadgeClass('x')).toContain('emerald')
  })

  it('aprobación activo lock', () => {
    expect(getApprovalLabel(false)).toBe('Pendiente')
    expect(getActiveLabel(false)).toBe('Baja')
    const future = new Date(Date.now() + 86400000).toISOString()
    expect(getLockLabel(future)).toContain('Bloqueado')
    expect(getLockLabel('x')).toBe('Sin bloqueo')
    expect(getLockBadgeClass()).toContain('slate')
    expect(getApprovalBadgeClass(false)).toContain('amber')
    expect(getApprovalBadgeClass(true)).toContain('emerald')
    expect(getActiveBadgeClass(false)).toContain('red')
  })
})
