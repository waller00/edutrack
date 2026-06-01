import { describe, it, expect } from 'vitest'
import { DEFAULT_PROFILE_PERMISSIONS } from './profile-permissions-defaults.js'

describe('DEFAULT_PROFILE_PERMISSIONS', () => {
  it('los 3 roles built-in pueden leer cursos (courses.read)', () => {
    // Garantiza el acceso de lectura de cursos por permiso (no por rol hardcodeado),
    // de modo que cualquier rol que herede courses.read pueda listar el catálogo.
    for (const role of ['ADMIN', 'STAFF', 'TEACHER'] as const) {
      const grant = DEFAULT_PROFILE_PERMISSIONS[role].find((p) => p.id === 'courses.read')
      expect(grant, `${role} debe tener courses.read`).toBeDefined()
      expect(grant?.enabled).toBe(true)
    }
  })

  it('STAFF y TEACHER se mantienen como roles separados', () => {
    expect(DEFAULT_PROFILE_PERMISSIONS.STAFF).toBeDefined()
    expect(DEFAULT_PROFILE_PERMISSIONS.TEACHER).toBeDefined()
  })
})
