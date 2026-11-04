import type { AuthMe } from '@/contexts/AuthContext'
import { DEFAULT_PROFILE_PERMISSIONS, BUILTIN_PROFILE_ROLES } from '../../../../../backend/src/identity/profile-permissions-defaults'
import { canSeeModule, visibleModules } from './modules'
import { isOnboardingStepPath, onboardingSteps, onboardingStorageKey } from './onboarding'

function profile(role: typeof BUILTIN_PROFILE_ROLES[number]): AuthMe {
  return { id: role, role, permissions: DEFAULT_PROFILE_PERMISSIONS[role].filter((p) => p.enabled) }
}

describe('onboarding por permisos reales', () => {
  it.each(BUILTIN_PROFILE_ROLES)('cubre las pantallas de %s sin ofrecer accesos ajenos', (role) => {
    const me = profile(role)
    const steps = onboardingSteps(me)
    // El docente empieza por su día; el resto, por su cuenta.
    expect(steps[0].module.id).toBe(role === 'TEACHER' ? 'home' : 'profile')
    expect(new Set(steps.map((step) => step.module.id)).size).toBe(steps.length)
    for (const step of steps) expect(canSeeModule(me, step.module), step.module.id).toBe(true)
    const skipped = role === 'TEACHER' ? ['guide'] : ['home', 'guide']
    const expected = visibleModules(me).filter((entry) => !skipped.includes(entry.id)).map((entry) => entry.id)
    expect(steps.map((step) => step.module.id).sort()).toEqual([...expected, 'messages'].sort())
  })

  it('Personal sólo recorre su cuenta, sus asistencias, sus licencias y mensajes', () => {
    expect(onboardingSteps(profile('STAFF')).map((step) => step.module.id)).toEqual([
      'profile', 'my-attendance', 'my-licenses', 'messages',
    ])
  })

  it('el docente trabaja en sus propias libretas y clases', () => {
    const steps = onboardingSteps(profile('TEACHER'))
    expect(steps[0].spots.map((spot) => spot.target)).toEqual(['home.today', 'home.pending', 'home.closings', 'nav:home'])
    expect(steps.find((step) => step.module.id === 'roll-call')).toBeDefined()
    const books = steps.find((step) => step.module.id === 'my-gradebooks')!
    expect(books.actions.join(' ')).toMatch(/calificaciones/)
    expect(books.actions.join(' ')).toMatch(/planificación/)
    expect(books.scopeLabel).toBe('Tu cuenta y lo asignado a vos')
    expect(steps.some((step) => step.module.id === 'staff-attendance')).toBe(false)
  })

  it('Dirección puede visar y Adscripción observar, sin indicarles que editen notas', () => {
    for (const role of ['ADSCRIPTO', 'DIRECCION'] as const) {
      const steps = onboardingSteps(profile(role))
      const books = steps.find((step) => step.module.id === 'gradebooks')!
      const control = steps.find((step) => step.module.id === 'gradebook-control')!
      expect(books.actions.join(' ')).not.toMatch(/Registrar evaluaciones|Cargar planificación|cerrar un período/)
      expect(control.actions.join(' ')).toContain('observaciones')
      expect(control.actions.some((text) => text.includes('Visar'))).toBe(role === 'DIRECCION')
      expect(steps.find((step) => step.module.id === 'staff-attendance')?.actions).toEqual([])
      expect(steps.find((step) => step.module.id === 'student-attendance')?.actions.join(' ')).toContain('justificativos')
    }
  })

  it('los perfiles personalizados de consulta no reciben acciones de escritura', () => {
    const me: AuthMe = { role: 'CONSULTA', permissions: [
      { id: 'users.read', scope: 'all' }, { id: 'gradebook.read', scope: 'all' },
      { id: 'attendance.read', scope: 'own' }, { id: 'analytics.read', scope: 'own' },
      { id: 'gradebook.grade', scope: 'own' },
    ] }
    const steps = onboardingSteps(me)
    expect(steps.every((step) => step.actions.length === 0)).toBe(true)
    expect(steps.some((step) => step.module.id === 'users')).toBe(true)
    expect(steps.some((step) => step.module.id === 'staff-indicators')).toBe(false)
    expect(steps.some((step) => step.module.id === 'staff-attendance')).toBe(false)
    expect(steps.some((step) => step.module.id === 'messages')).toBe(false)
  })

  it('los globos de un botón sólo se muestran a quien puede usarlo', () => {
    const reader: AuthMe = { id: 'r', role: 'CONSULTA', permissions: [{ id: 'users.read', scope: 'all' }] }
    const targets = (me: AuthMe) => onboardingSteps(me).find((step) => step.module.id === 'users')!.spots.map((spot) => spot.target)
    expect(targets(reader)).not.toContain('users.new')
    expect(targets({ ...reader, permissions: [...reader.permissions!, { id: 'users.create', scope: 'all' }] })).toContain('users.new')
  })

  it('los globos compartidos van al final: «¿Buscás…?» y dónde está en el menú', () => {
    const steps = onboardingSteps(profile('ADMIN'))
    const attendance = steps.find((step) => step.module.id === 'staff-attendance')!
    expect(attendance.spots.slice(-2).map((spot) => spot.target)).toEqual(['module-related', 'nav:staff-attendance'])
    expect(attendance.spots.at(-1)!.text).toBe('Para volver, está en el menú: Personal › Asistencia del personal.')
  })

  it('sin el menú de Configuración no se señala Mi perfil en el menú, y Mensajes se señala por su ícono', () => {
    const steps = onboardingSteps(profile('STAFF'))
    const targets = (id: string) => steps.find((step) => step.module.id === id)!.spots.map((spot) => spot.target)
    expect(targets('profile').some((target) => target.startsWith('nav:'))).toBe(false)
    expect(targets('messages')).toContain('messages.button')
    expect(targets('messages').some((target) => target.startsWith('nav:'))).toBe(false)
    expect(targets('my-attendance')).toContain('nav:my-attendance')
  })

  it('aísla el progreso por cuenta, rol y alcance, con orden de permisos estable', () => {
    const me = profile('STAFF')
    const key = onboardingStorageKey(me)
    expect(onboardingStorageKey({ ...me, permissions: [...me.permissions!].reverse() })).toBe(key)
    expect(onboardingStorageKey({ ...me, id: 'otro' })).not.toBe(key)
    expect(onboardingStorageKey({ ...me, role: 'CUSTOM' })).not.toBe(key)
    expect(onboardingStorageKey({ ...me, permissions: [{ id: 'attendance.read', scope: 'all' }] })).not.toBe(key)
    expect(onboardingStorageKey({ role: 'STAFF' })).toBeNull()
    expect(onboardingStorageKey(null)).toBeNull()
    expect(onboardingSteps(null)).toEqual([])
  })

  it('distingue el detalle de una libreta de otra sección como configuración o visado', () => {
    const book = onboardingSteps(profile('ADMIN')).find((step) => step.module.id === 'gradebooks')!
    expect(isOnboardingStepPath('/libreta/abc/evaluaciones', book)).toBe(true)
    expect(isOnboardingStepPath('/libreta/configuracion', book)).toBe(false)
    expect(isOnboardingStepPath('/libreta/control', book)).toBe(false)
    expect(isOnboardingStepPath('/libreta/abc/visado', book)).toBe(false)
    expect(isOnboardingStepPath('/libretas', book)).toBe(false)
  })

  it('acompaña el paso de control al abrir «Revisar» dentro de una libreta', () => {
    const control = onboardingSteps(profile('DIRECCION')).find((step) => step.module.id === 'gradebook-control')!
    expect(isOnboardingStepPath('/libreta/control', control)).toBe(true)
    expect(isOnboardingStepPath('/libreta/abc/visado', control)).toBe(true)
    expect(isOnboardingStepPath('/libreta/def/visado/', control)).toBe(true)
    expect(isOnboardingStepPath('/libreta/abc/evaluaciones', control)).toBe(false)
    expect(isOnboardingStepPath('/libreta/abc/visado-otro', control)).toBe(false)
    expect(isOnboardingStepPath('/libreta/configuracion', control)).toBe(false)
    expect(control.instructions).toContain('«Revisar»')
  })
})
