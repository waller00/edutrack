import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PROFILE_ROLES,
  DEFAULT_PROFILE_PERMISSIONS,
  ENFORCED_PROFILE_PERMISSION_SCOPES,
  permissionLocksFor,
  policyLockFor,
  REMOVED_PROFILE_PERMISSION_IDS,
  RETIRED_PERMISSION_CODES,
  REVOKED_PROFILE_PERMISSION_IDS,
  ROLE_LABELS,
  type BuiltinProfileRole,
} from './profile-permissions-defaults.js'
import { BUILTIN_ORG_ROLE_CODES, BUILTIN_ORG_ROLE_ROWS, RETIRED_ORG_ROLE_CODES } from './org-role-seed.js'

function grant(role: BuiltinProfileRole, id: string) {
  return DEFAULT_PROFILE_PERMISSIONS[role].find((p) => p.id === id)
}

function scopeOf(role: BuiltinProfileRole, id: string): 'own' | 'all' | null {
  const found = grant(role, id)
  return found?.enabled ? found.scope : null
}

const holdersOf = (id: string) => ALL_ROLES.filter((role) => scopeOf(role, id) !== null).sort()

const ALL_ROLES = BUILTIN_PROFILE_ROLES
const SUPERVISION = ['ADSCRIPTO', 'DIRECCION'] as const
/** Los perfiles que el liceo definió permiso por permiso (09/11/2026). */
const FIXED_ROLES = ['DIRECCION', 'ADSCRIPTO', 'SECRETARIA'] as const

const CATALOG = [...new Set(Object.values(DEFAULT_PROFILE_PERMISSIONS).flatMap((perms) => perms.map((p) => p.id)))]
const GRADEBOOK_IDS = CATALOG.filter((id) => id.startsWith('gradebook.') || id === 'academic-config.manage')
const STUDENT_FOLLOW_UP = [
  'students.manage',
  'students.accommodations',
  'student-attendance.take',
  'student-attendance.read',
  'student-attendance.justify',
  'student-attendance.manage',
  'student-reports.read',
  'academic-analytics.read',
]
const STAFF_CONTROL = [
  'users.read', 'users.create', 'users.update', 'users.security',
  'attendance.read', 'attendance.update', 'attendance.delete',
  'events.read', 'events.create', 'events.update', 'events.cancel', 'events.delete',
  'licenses.read', 'licenses.create', 'licenses.update', 'licenses.delete',
  'analytics.read', 'reports.read', 'exports.create',
]
const OWN_WORK = ['attendance.read', 'events.read', 'licenses.read']
const ACADEMIC_STRUCTURE = ['school-years.manage', 'courses.read', 'courses.manage']

describe('roles built-in', () => {
  it('el catálogo de OrgRole y la matriz de permisos declaran los mismos roles', () => {
    // Si divergen, un rol existe pero arranca sin ningún permiso (o al revés, se siembran
    // permisos para un rol que no existe). Ninguno de los dos falla ruidosamente en runtime.
    expect([...BUILTIN_ORG_ROLE_CODES].sort()).toEqual([...ALL_ROLES].sort())
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ALL_ROLES].sort())
  })

  it('Secretaría es un perfil del sistema', () => {
    expect(ROLE_LABELS.SECRETARIA).toBe('Secretaría')
    expect(BUILTIN_ORG_ROLE_ROWS.find((r) => r.code === 'SECRETARIA')?.label).toBe('Secretaría')
  })

  it('Inspección se retiró: no es del sistema ni tiene matriz', () => {
    expect(RETIRED_ORG_ROLE_CODES).toContain('INSPECCION')
    expect(BUILTIN_ORG_ROLE_CODES).not.toContain('INSPECCION')
    expect(Object.keys(DEFAULT_PROFILE_PERMISSIONS)).not.toContain('INSPECCION')
  })

  it('Staff se muestra como "Personal"', () => {
    expect(ROLE_LABELS.STAFF).toBe('Personal')
    expect(BUILTIN_ORG_ROLE_ROWS.find((r) => r.code === 'STAFF')?.label).toBe('Personal')
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

  it('ningún perfil declara dos veces el mismo permiso', () => {
    for (const role of ALL_ROLES) {
      const ids = DEFAULT_PROFILE_PERMISSIONS[role].map((p) => p.id)
      expect(ids.length, role).toBe(new Set(ids).size)
    }
  })
})

describe('libretas: Dirección y Adscripción tienen todo; visar es de Dirección', () => {
  it('Dirección tiene cada permiso de libretas con alcance all, también visar', () => {
    for (const id of GRADEBOOK_IDS) expect(scopeOf('DIRECCION', id), id).toBe('all')
  })

  it('Adscripción tiene lo mismo que Dirección, salvo visar', () => {
    for (const id of GRADEBOOK_IDS.filter((id) => id !== 'gradebook.endorse')) {
      expect(scopeOf('ADSCRIPTO', id), id).toBe('all')
    }
    expect(scopeOf('ADSCRIPTO', 'gradebook.endorse')).toBeNull()
    expect(REVOKED_PROFILE_PERMISSION_IDS.ADSCRIPTO?.['gradebook.endorse']).toMatch(/Dirección/)
  })

  it('visan sólo Dirección y Administración', () => {
    expect(holdersOf('gradebook.endorse')).toEqual(['ADMIN', 'DIRECCION'])
  })

  it('editan la libreta el docente (lo suyo), Administración, Dirección y Adscripción', () => {
    for (const id of ['gradebook.grade', 'gradebook.plan', 'gradebook.close']) {
      expect(holdersOf(id), id).toEqual(['ADMIN', 'ADSCRIPTO', 'DIRECCION', 'TEACHER'])
      expect(scopeOf('TEACHER', id), id).toBe('own')
    }
  })

  it('reabren períodos y corrigen desde la reunión Administración, Dirección y Adscripción', () => {
    expect(holdersOf('gradebook.manage')).toEqual(['ADMIN', 'ADSCRIPTO', 'DIRECCION'])
  })

  it('en bases que los tenían apagados, el arranque se los prende', () => {
    for (const role of SUPERVISION) {
      for (const id of ['gradebook.grade', 'gradebook.plan', 'gradebook.close', 'gradebook.manage', 'academic-config.manage']) {
        expect(ENFORCED_PROFILE_PERMISSION_SCOPES[role]?.[id]?.scope, `${role} ${id}`).toBe('all')
      }
    }
    expect(REMOVED_PROFILE_PERMISSION_IDS.DIRECCION.has('gradebook.plan')).toBe(false)
  })

  it('Secretaría no tiene nada de las libretas, y Personal tampoco', () => {
    for (const id of GRADEBOOK_IDS) {
      expect(scopeOf('SECRETARIA', id), id).toBeNull()
      expect(REVOKED_PROFILE_PERMISSION_IDS.SECRETARIA?.[id], id).toBeDefined()
      expect(scopeOf('STAFF', id), id).toBeNull()
    }
  })

  it('Administración edita todas las libretas', () => {
    for (const id of ['gradebook.grade', 'gradebook.plan', 'gradebook.close']) {
      expect(scopeOf('ADMIN', id), id).toBe('all')
      expect(ENFORCED_PROFILE_PERMISSION_SCOPES.ADMIN?.[id]?.scope, `forzar ${id} a ADMIN`).toBe('all')
    }
    expect(REVOKED_PROFILE_PERMISSION_IDS.ADMIN).toBeUndefined()
  })
})

describe('estudiantes: Dirección y Adscripción todo, salvo las mensualidades', () => {
  it('matrícula, adecuaciones, pase de lista, justificativos e indicadores con alcance all', () => {
    for (const role of SUPERVISION) {
      for (const id of STUDENT_FOLLOW_UP) {
        expect(scopeOf(role, id), `${role} ${id}`).toBe('all')
        expect(ENFORCED_PROFILE_PERMISSION_SCOPES[role]?.[id]?.scope, `forzar ${id} a ${role}`).toBe('all')
      }
    }
  })

  it('las mensualidades son de Secretaría y Administración', () => {
    expect(holdersOf('tuition.manage')).toEqual(['ADMIN', 'SECRETARIA'])
    for (const role of SUPERVISION) {
      expect(REVOKED_PROFILE_PERMISSION_IDS[role]?.['tuition.manage'], role).toMatch(/mensualidades/)
    }
  })

  it('Secretaría gestiona la matrícula, sin la asistencia, los indicadores ni las adecuaciones', () => {
    expect(scopeOf('SECRETARIA', 'students.manage')).toBe('all')
    for (const id of STUDENT_FOLLOW_UP.filter((id) => id !== 'students.manage')) {
      expect(scopeOf('SECRETARIA', id), id).toBeNull()
      expect(REVOKED_PROFILE_PERMISSION_IDS.SECRETARIA?.[id], id).toBeDefined()
    }
  })

  it('el docente pasa lista de lo suyo pero no justifica; Personal no tiene nada de estudiantes', () => {
    expect(scopeOf('TEACHER', 'student-attendance.take')).toBe('own')
    expect(scopeOf('TEACHER', 'student-attendance.justify')).toBeNull()
    for (const id of [...STUDENT_FOLLOW_UP, 'tuition.manage']) expect(scopeOf('STAFF', id), id).toBeNull()
  })

  it('reabrir listas cerradas (student-attendance.manage) es de Administración, Dirección y Adscripción', () => {
    expect(holdersOf('student-attendance.manage')).toEqual(['ADMIN', 'ADSCRIPTO', 'DIRECCION'])
  })
})

describe('personal: lo controlan Secretaría y Administración', () => {
  it('Secretaría tiene todo el grupo Personal con alcance all', () => {
    for (const id of STAFF_CONTROL) expect(scopeOf('SECRETARIA', id), id).toBe('all')
  })

  it('Dirección y Adscripción ven sólo lo suyo, en «Mi trabajo»', () => {
    for (const role of SUPERVISION) {
      for (const id of OWN_WORK) {
        expect(scopeOf(role, id), `${role} ${id}`).toBe('own')
        expect(ENFORCED_PROFILE_PERMISSION_SCOPES[role]?.[id]?.scope, `${role} ${id}`).toBe('own')
      }
      for (const id of STAFF_CONTROL.filter((id) => !OWN_WORK.includes(id))) {
        expect(scopeOf(role, id), `${role} ${id}`).toBeNull()
        expect(REVOKED_PROFILE_PERMISSION_IDS[role]?.[id], `${role} ${id}`).toMatch(/personal/)
      }
    }
  })

  it('exports.create (asistencia del personal y sueldos) es de Administración y Secretaría', () => {
    expect(holdersOf('exports.create')).toEqual(['ADMIN', 'SECRETARIA'])
  })
})

describe('académico: ciclos lectivos y cursos', () => {
  it('los gestionan Secretaría y Administración', () => {
    for (const id of ACADEMIC_STRUCTURE) expect(holdersOf(id), id).toEqual(['ADMIN', 'SECRETARIA'])
  })

  it('Dirección y Adscripción no los tienen (en bases viejas se les apagan)', () => {
    for (const role of SUPERVISION) {
      for (const id of ACADEMIC_STRUCTURE) {
        expect(REVOKED_PROFILE_PERMISSION_IDS[role]?.[id], `${role} ${id}`).toBeDefined()
      }
    }
  })

  it('el docente no ve el catálogo de cursos: sus libretas filtran por sus propios grupos', () => {
    expect(scopeOf('TEACHER', 'courses.read')).toBeNull()
    expect(REVOKED_PROFILE_PERMISSION_IDS.TEACHER?.['courses.read']).toBeDefined()
    expect(REMOVED_PROFILE_PERMISSION_IDS.TEACHER.has('courses.read')).toBe(true)
    expect(policyLockFor('TEACHER', 'courses.read')).toMatchObject({ enabled: false, scope: null })
    expect(scopeOf('TEACHER', 'gradebook.read')).toBe('own')
  })
})

describe('configuración y auditoría', () => {
  it('la configuración del sistema es de Secretaría y Administración', () => {
    expect(holdersOf('settings.manage')).toEqual(['ADMIN', 'SECRETARIA'])
    for (const role of ['DIRECCION', 'ADSCRIPTO', 'TEACHER', 'STAFF'] as const) {
      expect(policyLockFor(role, 'settings.manage'), role).toMatchObject({ enabled: false })
    }
  })

  it('la auditoría es sólo de Administración, y no se puede prender en otro perfil del sistema', () => {
    expect(holdersOf('audit.read')).toEqual(['ADMIN'])
    for (const role of ALL_ROLES.filter((role) => role !== 'ADMIN')) {
      expect(policyLockFor(role, 'audit.read'), role).toEqual({
        enabled: false,
        scope: null,
        reason: 'La auditoría es sólo de Administración.',
      })
    }
  })

  it('los perfiles los gestiona sólo Administración', () => {
    expect(holdersOf('profiles.manage')).toEqual(['ADMIN'])
  })
})

describe('perfiles fijos: Dirección, Adscripción y Secretaría', () => {
  it('cada permiso del catálogo se fuerza o se apaga, salvo los avisos y los mensajes propios', () => {
    for (const role of FIXED_ROLES) {
      const enforced = ENFORCED_PROFILE_PERMISSION_SCOPES[role] ?? {}
      const revoked = REVOKED_PROFILE_PERMISSION_IDS[role] ?? {}
      const undecided = CATALOG.filter(
        (id) => !(id in enforced) && !(id in revoked) && !['notifications.read', 'messaging.use'].includes(id),
      )
      expect(undecided, role).toEqual([])
      expect(Object.keys(enforced).filter((id) => id in revoked), `${role}: forzado y apagado a la vez`).toEqual([])
    }
  })

  it('lo forzado coincide con la matriz y siempre dice por qué', () => {
    for (const role of ALL_ROLES) {
      for (const [id, enforced] of Object.entries(ENFORCED_PROFILE_PERMISSION_SCOPES[role] ?? {})) {
        expect(scopeOf(role, id), `la matriz de ${role} debe coincidir con lo forzado (${id})`).toBe(enforced.scope)
        expect(enforced.reason.length, `${role} ${id}`).toBeGreaterThan(10)
      }
      for (const [id, reason] of Object.entries(REVOKED_PROFILE_PERMISSION_IDS[role] ?? {})) {
        expect(scopeOf(role, id), `${role} no puede sembrar ${id} y apagarlo`).toBeNull()
        expect(reason.length, `${role} ${id}`).toBeGreaterThan(10)
      }
    }
  })

  it('todos reciben sus avisos y usan la mensajería', () => {
    for (const role of ALL_ROLES) {
      expect(scopeOf(role, 'notifications.read'), role).toBe('own')
      expect(scopeOf(role, 'messaging.use'), role).toBe('own')
    }
  })
})

describe('Personal: sólo sus ingresos y sus licencias', () => {
  it('tiene exactamente sus asistencias, sus licencias y sus avisos', () => {
    expect(DEFAULT_PROFILE_PERMISSIONS.STAFF.map((p) => `${p.id}:${p.scope}`).sort()).toEqual([
      'attendance.read:own',
      'licenses.read:own',
      'messaging.use:own',
      'notifications.read:own',
    ])
  })

  it('lo académico que heredaba del docente se apaga en bases existentes', () => {
    for (const id of ['events.read', 'courses.read', 'student-attendance.take', 'gradebook.read', 'gradebook.grade']) {
      expect(REVOKED_PROFILE_PERMISSION_IDS.STAFF?.[id], `apagar ${id}`).toBeDefined()
      expect(REMOVED_PROFILE_PERMISSION_IDS.STAFF.has(id), `dejar de sembrar ${id}`).toBe(true)
    }
  })
})

describe('permisos fijos en Roles / Perfiles', () => {
  it('lo que el arranque fuerza o apaga se muestra fijo, con su motivo', () => {
    const admin = permissionLocksFor('ADMIN', new Set())
    expect(admin.get('gradebook.grade')).toEqual({
      enabled: true,
      scope: 'all',
      reason: 'Administración edita todo, también las libretas.',
    })
    const direccion = permissionLocksFor('DIRECCION', new Set())
    expect(direccion.get('gradebook.grade')).toMatchObject({ enabled: true, scope: 'all' })
    expect(direccion.get('attendance.read')).toMatchObject({ enabled: true, scope: 'own' })
    expect(direccion.get('users.read')).toMatchObject({ enabled: false, scope: null })
    expect(permissionLocksFor('SECRETARIA', new Set()).get('tuition.manage')).toMatchObject({ enabled: true, scope: 'all' })
  })

  it('un permiso que dejó de ser del perfil queda fijo sólo si está apagado', () => {
    // Prendido, autoriza: la pantalla lo muestra para que se pueda apagar.
    expect(permissionLocksFor('TEACHER', new Set(['events.update'])).has('events.update')).toBe(false)
    expect(permissionLocksFor('TEACHER', new Set()).get('events.update')).toEqual({
      enabled: false,
      scope: null,
      reason: 'No corresponde a este perfil.',
    })
  })

  it('un perfil personalizado no tiene permisos fijos', () => {
    expect(permissionLocksFor('COORDINADOR', new Set()).size).toBe(0)
    expect(policyLockFor('COORDINADOR', 'gradebook.grade')).toBeNull()
  })

  it('los permisos que ninguna ruta consulta no se siembran', () => {
    for (const role of ALL_ROLES) {
      for (const id of RETIRED_PERMISSION_CODES) expect(scopeOf(role, id), `${role} ${id}`).toBeNull()
    }
  })
})

describe('exportar libretas y boletines', () => {
  it('Administración, Dirección y Adscripción exportan todas; cada docente las suyas', () => {
    expect(scopeOf('ADMIN', 'gradebook.export')).toBe('all')
    expect(scopeOf('DIRECCION', 'gradebook.export')).toBe('all')
    expect(scopeOf('ADSCRIPTO', 'gradebook.export')).toBe('all')
    expect(scopeOf('TEACHER', 'gradebook.export')).toBe('own')
    expect(scopeOf('STAFF', 'gradebook.export')).toBeNull()
    expect(scopeOf('SECRETARIA', 'gradebook.export')).toBeNull()
  })
})
