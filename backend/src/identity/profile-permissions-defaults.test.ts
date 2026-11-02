import { describe, it, expect } from 'vitest'
import { DEFAULT_PROFILE_PERMISSIONS } from './profile-permissions-defaults.js'

describe('DEFAULT_PROFILE_PERMISSIONS', () => {
  it('Administración, Dirección y Adscripción leen los cursos (courses.read); el docente y Personal no', () => {
    // Garantiza el acceso de lectura de cursos por permiso (no por rol hardcodeado),
    // de modo que cualquier rol que herede courses.read pueda listar el catálogo.
    for (const role of ['ADMIN', 'ADSCRIPTO', 'DIRECCION'] as const) {
      const grant = DEFAULT_PROFILE_PERMISSIONS[role].find((p) => p.id === 'courses.read')
      expect(grant, `${role} debe tener courses.read`).toBeDefined()
      expect(grant?.enabled).toBe(true)
    }
    for (const role of ['TEACHER', 'STAFF'] as const) {
      expect(DEFAULT_PROFILE_PERMISSIONS[role].find((p) => p.id === 'courses.read'), role).toBeUndefined()
    }
  })

  it('STAFF y TEACHER se mantienen como roles separados', () => {
    expect(DEFAULT_PROFILE_PERMISSIONS.STAFF).toBeDefined()
    expect(DEFAULT_PROFILE_PERMISSIONS.TEACHER).toBeDefined()
  })

  it('todo el personal usa la mensajería (cada uno, sus conversaciones)', () => {
    for (const [role, grants] of Object.entries(DEFAULT_PROFILE_PERMISSIONS)) {
      const grant = grants.find((p) => p.id === 'messaging.use')
      expect(grant, `${role} debe tener messaging.use`).toMatchObject({ enabled: true, scope: 'own' })
    }
  })
})
