import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PROFILE_ROLES,
  DEFAULT_PROFILE_PERMISSIONS,
  ENFORCED_PROFILE_PERMISSION_SCOPES,
  REMOVED_PROFILE_PERMISSION_IDS,
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

const ALL_ROLES = BUILTIN_PROFILE_ROLES
const SUPERVISION = ['ADSCRIPTO', 'DIRECCION'] as const

describe('roles built-in de la libreta', () => {
  it('el catálogo de OrgRole y la matriz de permisos declaran los mismos roles', () => {
    // Si divergen, un rol existe pero arranca sin ningún permiso (o al revés, se siembran
    // permisos para un rol que no existe). Ninguno de los dos falla ruidosamente en runtime.
    expect([...BUILTIN_ORG_ROLE_CODES].sort()).toEqual([...ALL_ROLES].sort())
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ALL_ROLES].sort())
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
})

describe('visado: sólo Dirección', () => {
  it('gradebook.endorse lo tienen únicamente DIRECCION y ADMIN', () => {
    const withEndorse = ALL_ROLES.filter((role) => scopeOf(role, 'gradebook.endorse') !== null)
    expect(withEndorse.sort()).toEqual(['ADMIN', 'DIRECCION'])
  })

  it('ADSCRIPTO controla y observa, pero no visa', () => {
    expect(scopeOf('ADSCRIPTO', 'gradebook.review')).toBe('all')
    expect(scopeOf('ADSCRIPTO', 'gradebook.endorse')).toBeNull()
  })

  it('gradebook.inspect quedó sólo en ADMIN', () => {
    const withInspect = ALL_ROLES.filter((role) => scopeOf(role, 'gradebook.inspect') !== null)
    expect(withInspect).toEqual(['ADMIN'])
  })
})

describe('calificar: sólo el docente sobre lo propio', () => {
  it('TEACHER califica y cierra con alcance own', () => {
    expect(scopeOf('TEACHER', 'gradebook.grade')).toBe('own')
    expect(scopeOf('TEACHER', 'gradebook.close')).toBe('own')
    expect(scopeOf('TEACHER', 'gradebook.read')).toBe('own')
  })

  it('ni la supervisión ni Personal escriben notas', () => {
    for (const role of [...SUPERVISION, 'STAFF'] as const) {
      expect(scopeOf(role, 'gradebook.grade'), `${role} no debe calificar`).toBeNull()
      expect(scopeOf(role, 'gradebook.close'), `${role} no debe cerrar períodos`).toBeNull()
    }
  })

  it('sólo el docente califica, planifica y cierra: tampoco Administración', () => {
    for (const id of ['gradebook.grade', 'gradebook.plan', 'gradebook.close']) {
      const holders = ALL_ROLES.filter((role) => scopeOf(role, id) !== null)
      expect(holders, id).toEqual(['TEACHER'])
      expect(REVOKED_PROFILE_PERMISSION_IDS.ADMIN, `apagar ${id} a ADMIN en producción`).toContain(id)
      expect(REMOVED_PROFILE_PERMISSION_IDS.ADMIN.has(id)).toBe(true)
    }
  })

  it('gradebook.manage (reabrir períodos) es sólo de ADMIN', () => {
    const withManage = ALL_ROLES.filter((role) => scopeOf(role, 'gradebook.manage') !== null)
    expect(withManage).toEqual(['ADMIN'])
  })
})

describe('planificar: sólo el docente edita su libreta', () => {
  it('el docente planifica lo propio', () => {
    expect(scopeOf('TEACHER', 'gradebook.plan')).toBe('own')
  })

  it('Dirección ve la libreta pero no edita nada: ni notas, ni juicios, ni planificación', () => {
    // El director observa y avisa al docente; no corrige por él.
    expect(scopeOf('DIRECCION', 'gradebook.read')).toBe('all')
    expect(scopeOf('DIRECCION', 'gradebook.plan')).toBeNull()
    expect(scopeOf('DIRECCION', 'gradebook.grade')).toBeNull()
    expect(scopeOf('DIRECCION', 'gradebook.close')).toBeNull()
  })

  it('a Dirección se le apaga `gradebook.plan` en bases que ya lo tenían', () => {
    expect(REVOKED_PROFILE_PERMISSION_IDS.DIRECCION).toContain('gradebook.plan')
    expect(REMOVED_PROFILE_PERMISSION_IDS.DIRECCION.has('gradebook.plan')).toBe(true)
  })

  it('adscripción no edita la libreta: sólo controla', () => {
    expect(scopeOf('ADSCRIPTO', 'gradebook.plan')).toBeNull()
  })
})

describe('supervisión: Dirección y Adscripción ven lo mismo que Administración', () => {
  const READ_ALL = [
    'users.read',
    'attendance.read',
    'events.read',
    'licenses.read',
    'analytics.read',
    'reports.read',
    'courses.read',
    'gradebook.read',
    'academic-analytics.read',
    'student-attendance.read',
    'student-reports.read',
    'audit.read',
  ]

  it('leen todo el centro', () => {
    for (const role of SUPERVISION) {
      for (const id of READ_ALL) {
        expect(scopeOf(role, id), `${role} debe ver ${id}`).toBe('all')
        expect(scopeOf('ADMIN', id), `ADMIN también tiene ${id}`).toBe('all')
      }
    }
  })

  it('no crean ni editan lo de Administración', () => {
    const ADMIN_ONLY = [
      'users.create', 'users.update', 'users.security',
      'attendance.update', 'attendance.delete', 'attendance.biometric',
      'events.create', 'events.update', 'events.cancel', 'events.delete',
      'licenses.create', 'licenses.update', 'licenses.delete',
      'exports.create', 'school-years.manage', 'courses.manage', 'students.manage',
      'academic-config.manage', 'settings.manage', 'profiles.manage', 'student-attendance.manage',
    ]
    for (const role of SUPERVISION) {
      for (const id of ADMIN_ONLY) {
        expect(scopeOf(role, id), `${role} no debe tener ${id}`).toBeNull()
      }
    }
  })

  it('el alcance nuevo se fuerza en bases que tenían la línea base propia', () => {
    for (const role of SUPERVISION) {
      expect(ENFORCED_PROFILE_PERMISSION_SCOPES[role]).toEqual({
        'attendance.read': 'all',
        'events.read': 'all',
        'licenses.read': 'all',
      })
      for (const [id, scope] of Object.entries(ENFORCED_PROFILE_PERMISSION_SCOPES[role] ?? {})) {
        expect(scopeOf(role, id), `la matriz de ${role} debe coincidir con lo forzado`).toBe(scope)
      }
    }
  })

  it('reciben notificaciones', () => {
    for (const role of SUPERVISION) {
      expect(scopeOf(role, 'notifications.read')).toBe('own')
    }
  })
})

describe('Personal: sólo sus ingresos y sus licencias', () => {
  it('tiene exactamente sus asistencias, sus licencias y sus avisos', () => {
    expect(DEFAULT_PROFILE_PERMISSIONS.STAFF.map((p) => `${p.id}:${p.scope}`).sort()).toEqual([
      'attendance.read:own',
      'licenses.read:own',
      'notifications.read:own',
    ])
  })

  it('lo académico que heredaba del docente se apaga en bases existentes', () => {
    for (const id of ['events.read', 'courses.read', 'student-attendance.take', 'gradebook.read', 'gradebook.grade']) {
      expect(REVOKED_PROFILE_PERMISSION_IDS.STAFF, `apagar ${id}`).toContain(id)
      expect(REMOVED_PROFILE_PERMISSION_IDS.STAFF.has(id), `dejar de sembrar ${id}`).toBe(true)
    }
  })
})

describe('lectura y análisis', () => {
  it('la supervisión lee libretas de todo el centro', () => {
    for (const role of SUPERVISION) {
      expect(scopeOf(role, 'gradebook.read')).toBe('all')
    }
  })

  it('los indicadores académicos son de ADMIN, DIRECCION y ADSCRIPTO', () => {
    const withAnalytics = ALL_ROLES.filter((role) => scopeOf(role, 'academic-analytics.read') !== null)
    expect(withAnalytics.sort()).toEqual(['ADMIN', 'ADSCRIPTO', 'DIRECCION'])
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
})

describe('inasistencias: adscripción justifica, el docente no', () => {
  it('ADSCRIPTO justifica faltas de todo el centro', () => {
    // En cursos superiores la justificación es administrativa, no del docente.
    expect(scopeOf('ADSCRIPTO', 'student-attendance.justify')).toBe('all')
    expect(scopeOf('ADSCRIPTO', 'student-attendance.read')).toBe('all')
  })

  it('reportes y alertas: adscripción y dirección sí, el docente y Personal no', () => {
    for (const role of ['ADMIN', ...SUPERVISION] as const) {
      expect(scopeOf(role, 'student-reports.read'), `${role} debe ver reportes`).toBe('all')
    }
    for (const role of ['TEACHER', 'STAFF'] as const) {
      expect(scopeOf(role, 'student-reports.read'), `${role} no debe ver reportes`).toBeNull()
    }
  })

  it('DIRECCION también justifica, previa o posteriormente', () => {
    expect(scopeOf('DIRECCION', 'student-attendance.justify')).toBe('all')
    expect(scopeOf('DIRECCION', 'student-attendance.read')).toBe('all')
    expect(scopeOf('DIRECCION', 'student-attendance.manage')).toBeNull()
  })

  it('el docente pasa lista pero no justifica', () => {
    expect(scopeOf('TEACHER', 'student-attendance.take')).toBe('own')
    expect(scopeOf('TEACHER', 'student-attendance.justify')).toBeNull()
  })

  it('justificar y controlar son permisos distintos', () => {
    // `manage` además reabre listas cerradas: adscripción no necesita eso para justificar.
    expect(scopeOf('ADSCRIPTO', 'student-attendance.manage')).toBeNull()
    const withManage = ALL_ROLES.filter((role) => scopeOf(role, 'student-attendance.manage') !== null)
    expect(withManage).toEqual(['ADMIN'])
  })
})

describe('exportar libretas y boletines', () => {
  it('supervisión exporta todas y cada docente las suyas', () => {
    expect(scopeOf('ADMIN', 'gradebook.export')).toBe('all')
    expect(scopeOf('DIRECCION', 'gradebook.export')).toBe('all')
    expect(scopeOf('ADSCRIPTO', 'gradebook.export')).toBe('all')
    expect(scopeOf('TEACHER', 'gradebook.export')).toBe('own')
    expect(scopeOf('STAFF', 'gradebook.export')).toBeNull()
  })

  it('nadie fuera de administración recibe exports.create: abre la nómina y la asistencia del personal', () => {
    const withGeneralExports = ALL_ROLES.filter((role) => scopeOf(role, 'exports.create') !== null)
    expect(withGeneralExports).toEqual(['ADMIN'])
  })
})
