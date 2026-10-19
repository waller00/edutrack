import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_PERMISSIONS, type BuiltinProfileRole } from './profile-permissions-defaults.js'

/**
 * La matriz de permisos contra las rutas.
 *
 * Los tests de rutas no la ejercitan: en `NODE_ENV=test`, `userPermissionScope` resuelve por rol
 * (ADMIN = all, el resto = own) sea cual sea el permiso. Así una ruta podía pedir un permiso que no
 * tiene nadie, o uno equivocado, sin que fallara nada. Esto lee las rutas y lo cruza con la matriz.
 */

const ROUTES_DIR = join(__dirname, '..', 'routes')

type RouteGuard = { file: string; method: string; path: string; permission: string }

function routeGuards(): RouteGuard[] {
  const guards: RouteGuard[] = []
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
    const source = readFileSync(join(ROUTES_DIR, file), 'utf8')
    const pattern = /\br\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,\s*requirePermission\(\s*['"]([^'"]+)['"]/g
    for (const m of source.matchAll(pattern)) guards.push({ file, method: m[1], path: m[2], permission: m[3] })
  }
  return guards
}

function permissionsUsed(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>()
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
    const source = readFileSync(join(ROUTES_DIR, file), 'utf8')
    for (const m of source.matchAll(/requirePermission\(\s*['"]([^'"]+)['"]/g)) {
      used.set(m[1], (used.get(m[1]) ?? new Set()).add(file))
    }
  }
  return used
}

const grantsOf = (role: BuiltinProfileRole) =>
  new Map(DEFAULT_PROFILE_PERMISSIONS[role].filter((p) => p.enabled).map((p) => [p.id, p.scope]))

/** Permisos que ninguna matriz de fábrica concede a propósito: sólo los da un perfil a medida. */
const CUSTOM_PROFILE_ONLY: Record<string, string> = {
  // Marcar la propia asistencia a mano: se le quitó a docente y staff (REMOVED_PROFILE_PERMISSION_IDS).
  'attendance.create': 'registro manual de asistencia',
}

describe('matriz de permisos vs. rutas', () => {
  it('toda ruta pide un permiso que algún rol de fábrica tiene (salvo los de perfiles a medida)', () => {
    const granted = new Set(
      Object.values(DEFAULT_PROFILE_PERMISSIONS).flatMap((perms) => perms.map((p) => p.id)),
    )
    const orphans = [...permissionsUsed()]
      .filter(([permission]) => !granted.has(permission) && !(permission in CUSTOM_PROFILE_ONLY))
      .map(([permission, files]) => `${permission} (${[...files].join(', ')})`)
    expect(orphans).toEqual([])
  })

  it('las descargas de libretas y boletines piden gradebook.export, no read ni exports.create', () => {
    const exportRoutes = routeGuards().filter(
      (g) => /gradebook/.test(g.file) && /export|report-card/.test(g.path),
    )
    expect(exportRoutes.length).toBeGreaterThan(0)
    const wrong = exportRoutes.filter((g) => g.permission !== 'gradebook.export')
    expect(wrong.map((g) => `${g.method.toUpperCase()} ${g.path} → ${g.permission}`)).toEqual([])
  })
})

describe('invariantes de la matriz (CLAUDE.md)', () => {
  it('dirección no edita la libreta: ni planifica ni califica', () => {
    const direccion = grantsOf('DIRECCION')
    expect(direccion.has('gradebook.plan')).toBe(false)
    expect(direccion.has('gradebook.grade')).toBe(false)
  })

  it('sólo dirección visa', () => {
    const withEndorse = (Object.keys(DEFAULT_PROFILE_PERMISSIONS) as BuiltinProfileRole[]).filter(
      (role) => role !== 'ADMIN' && grantsOf(role).has('gradebook.endorse'),
    )
    expect(withEndorse).toEqual(['DIRECCION'])
  })

  it('exports.create (asistencia del personal y sueldos) es sólo de administración', () => {
    const withExports = (Object.keys(DEFAULT_PROFILE_PERMISSIONS) as BuiltinProfileRole[]).filter((role) =>
      grantsOf(role).has('exports.create'),
    )
    expect(withExports).toEqual(['ADMIN'])
  })

  it('el docente sólo tiene alcance propio en la libreta', () => {
    const scopes = [...grantsOf('TEACHER')].filter(([id]) => id.startsWith('gradebook.')).map(([, scope]) => scope)
    expect(new Set(scopes)).toEqual(new Set(['own']))
  })

  it('Personal no tiene nada de la libreta', () => {
    expect([...grantsOf('STAFF').keys()].filter((id) => id.startsWith('gradebook.'))).toEqual([])
  })
})
