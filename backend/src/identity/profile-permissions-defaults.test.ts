import { describe, it, expect } from 'vitest'
import { DEFAULT_PROFILE_PERMISSIONS } from './profile-permissions-defaults.js'

describe('DEFAULT_PROFILE_PERMISSIONS', () => {
  it('Administración y Secretaría leen los cursos (courses.read); Dirección, Adscripción, el docente y Personal no', () => {
    // Garantiza el acceso de lectura de cursos por permiso (no por rol hardcodeado),
    // de modo que cualquier rol que herede courses.read pueda listar el catálogo. Dirección y
    // Adscripción leen el que necesita la matrícula por `students.manage` (`requireCatalogRead`).
    for (const role of ['ADMIN', 'SECRETARIA'] as const) {
      const grant = DEFAULT_PROFILE_PERMISSIONS[role].find((p) => p.id === 'courses.read')
      expect(grant, `${role} debe tener courses.read`).toBeDefined()
      expect(grant?.enabled).toBe(true)
    }
    for (const role of ['DIRECCION', 'ADSCRIPTO', 'TEACHER', 'STAFF'] as const) {
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
