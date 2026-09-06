import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PROFILE_ROLES,
  DEFAULT_PROFILE_PERMISSIONS,
  REMOVED_PROFILE_PERMISSION_IDS,
  ROLE_LABELS,
  type BuiltinProfileRole,
} from './profile-permissions-defaults.js'
import { BUILTIN_ORG_ROLE_CODES, BUILTIN_ORG_ROLE_ROWS } from './org-role-seed.js'

function grant(role: BuiltinProfileRole, id: string) {
  return DEFAULT_PROFILE_PERMISSIONS[role].find((p) => p.id === id)
}

function scopeOf(role: BuiltinProfileRole, id: string): 'own' | 'all' | null {
  const found = grant(role, id)
  return found?.enabled ? found.scope : null
}

const ALL_ROLES = BUILTIN_PROFILE_ROLES

describe('roles built-in de la libreta', () => {
  it('el catálogo de OrgRole y la matriz de permisos declaran los mismos roles', () => {
    // Si divergen, un rol existe pero arranca sin ningún permiso (o al revés, se siembran
    // permisos para un rol que no existe). Ninguno de los dos falla ruidosamente en runtime.
    expect([...BUILTIN_ORG_ROLE_CODES].sort()).toEqual([...ALL_ROLES].sort())
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ALL_ROLES].sort())
  })

  it('todo rol de la matriz tiene su set de permisos retirados', () => {
    for (const role of ALL_ROLES) {
      expect(REMOVED_PROFILE_PERMISSION_IDS[role], `falta el set de ${role}`).toBeDefined()
    }
  })

  it('los códigos de OrgRole son válidos para los guards', () => {
    for (const row of BUILTIN_ORG_ROLE_ROWS) {
      expect(row.code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})

describe('visado: sólo Dirección', () => {
  it('gradebook.endorse lo tienen únicamente DIRECCION y ADMIN', () => {
    const withEndorse = ALL_ROLES.filter((role) => scopeOf(role, 'gradebook.endorse') !== null)
    expect(withEndorse.sort()).toEqual(['ADMIN', 'DIRECCION'])
  })

  it('INSPECCION no puede visar: el pliego prohíbe que modifique los visados de Dirección', () => {
    expect(scopeOf('INSPECCION', 'gradebook.endorse')).toBeNull()
    expect(scopeOf('INSPECCION', 'gradebook.manage')).toBeNull()
    expect(scopeOf('INSPECCION', 'gradebook.review')).toBeNull()
  })

  it('ADSCRIPTO controla y observa, pero no visa', () => {
    expect(scopeOf('ADSCRIPTO', 'gradebook.review')).toBe('all')
    expect(scopeOf('ADSCRIPTO', 'gradebook.endorse')).toBeNull()
  })

  it('gradebook.inspect es exclusivo de INSPECCION y ADMIN', () => {
    const withInspect = ALL_ROLES.filter((role) => scopeOf(role, 'gradebook.inspect') !== null)
    expect(withInspect.sort()).toEqual(['ADMIN', 'INSPECCION'])
  })
})

describe('calificar: sólo el docente sobre lo propio', () => {
  it('TEACHER y STAFF califican y cierran con alcance own', () => {
    for (const role of ['TEACHER', 'STAFF'] as const) {
      expect(scopeOf(role, 'gradebook.grade')).toBe('own')
      expect(scopeOf(role, 'gradebook.close')).toBe('own')
      expect(scopeOf(role, 'gradebook.read')).toBe('own')
    }
  })

  it('ningún rol de supervisión puede escribir notas', () => {
    for (const role of ['ADSCRIPTO', 'DIRECCION', 'INSPECCION'] as const) {
      expect(scopeOf(role, 'gradebook.grade'), `${role} no debe calificar`).toBeNull()
      expect(scopeOf(role, 'gradebook.close'), `${role} no debe cerrar períodos`).toBeNull()
    }
  })

  it('gradebook.manage (corregir y reabrir fuera de plazo) es sólo de ADMIN', () => {
    const withManage = ALL_ROLES.filter((role) => scopeOf(role, 'gradebook.manage') !== null)
    expect(withManage).toEqual(['ADMIN'])
  })
})

describe('lectura y análisis', () => {
  it('los tres roles de supervisión leen libretas de todo el centro', () => {
    for (const role of ['ADSCRIPTO', 'DIRECCION', 'INSPECCION'] as const) {
      expect(scopeOf(role, 'gradebook.read')).toBe('all')
    }
  })

  it('los indicadores académicos son de ADMIN, DIRECCION e INSPECCION', () => {
    const withAnalytics = ALL_ROLES.filter((role) => scopeOf(role, 'academic-analytics.read') !== null)
    expect(withAnalytics.sort()).toEqual(['ADMIN', 'DIRECCION', 'INSPECCION'])
  })

  it('la parametrización académica queda sólo en ADMIN', () => {
    const withConfig = ALL_ROLES.filter((role) => scopeOf(role, 'academic-config.manage') !== null)
    expect(withConfig).toEqual(['ADMIN'])
  })

  it('todo rol con acceso a libretas puede leer el catálogo de cursos para filtrar', () => {
    for (const role of ALL_ROLES) {
      if (scopeOf(role, 'gradebook.read') === null) continue
      expect(scopeOf(role, 'courses.read'), `${role} necesita courses.read`).not.toBeNull()
    }
  })

  it('todos los roles nuevos reciben notificaciones', () => {
    for (const role of ['ADSCRIPTO', 'DIRECCION', 'INSPECCION'] as const) {
      expect(scopeOf(role, 'notifications.read')).toBe('own')
    }
  })

  it('INSPECCION no lleva la línea base de personal: no es funcionario del centro', () => {
    for (const id of ['attendance.read', 'events.read', 'licenses.read']) {
      expect(scopeOf('INSPECCION', id), `INSPECCION no debería tener ${id}`).toBeNull()
    }
  })
})
