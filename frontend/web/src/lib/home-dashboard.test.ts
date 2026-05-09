import {
  getHomeSectionIconKind,
  getVisibleHomeSections,
  getWelcomeMessage,
  HOME_SECTIONS_BY_ROLE,
} from '@/lib/home-dashboard'
import type { HomeMe } from '@/lib/home-dashboard'

function me(partial: Partial<HomeMe> & Pick<HomeMe, 'email' | 'role'>): HomeMe {
  return {
    email: partial.email,
    role: partial.role,
    isApproved: partial.isApproved ?? true,
    isActive: partial.isActive ?? true,
    needsProfileCompletion: partial.needsProfileCompletion ?? false,
    emailVerifiedAt: partial.emailVerifiedAt ?? '2024-01-01',
    name: partial.name,
  }
}

describe('getWelcomeMessage', () => {
  it('prioriza cuenta inactiva', () => {
    expect(getWelcomeMessage(true, true)).toContain('desactivada')
  })

  it('muestra pendiente de aprobación si no está inactiva', () => {
    expect(getWelcomeMessage(false, true)).toContain('administrador')
  })

  it('mensaje por defecto', () => {
    expect(getWelcomeMessage(false, false)).toContain('Bienvenido')
  })
})

describe('getHomeSectionIconKind', () => {
  it.each([
    ['Gestión de usuarios', 'users'],
    ['Gestión de perfiles', 'profiles'],
    ['Configuración del sistema', 'settings'],
    ['asistencias', 'chart'],
    ['eventos', 'calendar'],
    ['Gestión de eventos y notificaciones', 'calendar'],
    ['licencias', 'file'],
    ['Analíticas', 'analytics'],
    ['Panel admin', 'dashboard'],
    ['Otro', 'default'],
  ])('%s → %s', (title, kind) => {
    expect(getHomeSectionIconKind(title)).toBe(kind)
  })
})

describe('getVisibleHomeSections', () => {
  it('vacío si perfil incompleto', () => {
    expect(getVisibleHomeSections(me({ email: 'a@b.c', role: 'ADMIN', needsProfileCompletion: true }))).toEqual([])
  })

  it('vacío si no aprobado', () => {
    expect(getVisibleHomeSections(me({ email: 'a@b.c', role: 'TEACHER', isApproved: false }))).toEqual([])
  })

  it('vacío si inactivo', () => {
    expect(getVisibleHomeSections(me({ email: 'a@b.c', role: 'STAFF', isActive: false }))).toEqual([])
  })

  it('ADMIN ve todas las secciones admin', () => {
    const s = getVisibleHomeSections(me({ email: 'a@b.c', role: 'ADMIN' }))
    expect(s).toEqual(HOME_SECTIONS_BY_ROLE.ADMIN)
    expect(s.some((section) => section.title === 'Configuración del sistema')).toBe(false)
    expect(s.some((section) => section.title === 'Gestión de perfiles')).toBe(false)
  })

  it('TEACHER y STAFF ven sus rutas', () => {
    expect(getVisibleHomeSections(me({ email: 't@b.c', role: 'TEACHER' }))).toEqual(HOME_SECTIONS_BY_ROLE.TEACHER)
    expect(getVisibleHomeSections(me({ email: 's@b.c', role: 'STAFF' }))).toEqual(HOME_SECTIONS_BY_ROLE.STAFF)
  })

  it('rol no mapeado devuelve lista vacía', () => {
    const u = { ...me({ email: 'x@y.z', role: 'ADMIN' }), role: 'UNKNOWN' as HomeMe['role'] }
    expect(getVisibleHomeSections(u)).toEqual([])
  })
})
