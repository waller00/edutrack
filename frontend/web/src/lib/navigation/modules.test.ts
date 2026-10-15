import { describe, expect, it } from 'vitest'
import {
  APP_MODULES,
  canSeeModule,
  moduleById,
  NAV_GROUP_META,
  NAV_GROUP_ORDER,
  quickAccessModules,
  visibleNavGroups,
  visibleRelated,
} from './modules'

const teacher = {
  permissions: [
    { id: 'events.read', scope: 'own' as const },
    { id: 'attendance.read', scope: 'own' as const },
    { id: 'licenses.read', scope: 'own' as const },
    { id: 'gradebook.read', scope: 'own' as const },
    { id: 'student-attendance.take', scope: 'own' as const },
  ],
}

const direccion = {
  permissions: [
    { id: 'attendance.read', scope: 'own' as const },
    { id: 'gradebook.read', scope: 'all' as const },
    { id: 'gradebook.review', scope: 'all' as const },
    { id: 'academic-analytics.read', scope: 'all' as const },
    { id: 'student-attendance.justify', scope: 'all' as const },
  ],
}

const admin = {
  permissions: [
    { id: 'attendance.read', scope: 'all' as const },
    { id: 'licenses.read', scope: 'all' as const },
    { id: 'analytics.read', scope: 'all' as const },
    { id: 'student-attendance.manage', scope: 'all' as const },
    { id: 'academic-analytics.read', scope: 'all' as const },
  ],
}

describe('catálogo de módulos', () => {
  it('no repite ids y cada módulo está en un grupo conocido', () => {
    const ids = APP_MODULES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of APP_MODULES) expect(NAV_GROUP_ORDER).toContain(entry.group)
  })

  it('cada módulo explica para qué sirve', () => {
    for (const entry of APP_MODULES) {
      expect(entry.description.length, entry.id).toBeGreaterThanOrEqual(20)
    }
    for (const id of NAV_GROUP_ORDER) expect(NAV_GROUP_META[id].description.length).toBeGreaterThan(10)
  })

  it('los "¿Buscabas…?" apuntan a módulos que existen y no a sí mismos', () => {
    for (const entry of APP_MODULES) {
      for (const related of entry.related ?? []) {
        expect(() => moduleById(related.id)).not.toThrow()
        expect(related.id).not.toBe(entry.id)
      }
    }
  })

  it('ninguna etiqueta dice "asistencia" ni "control" sin decir de quién', () => {
    // "Mis asistencias" dice de quién; "Asistencias" a secas era la que confundía.
    for (const entry of APP_MODULES) {
      expect(entry.label).not.toMatch(/^(asistencias?|control|indicadores)$/i)
    }
    expect(moduleById('staff-attendance').label).toBe('Asistencia del personal')
    expect(moduleById('student-attendance').label).toBe('Asistencia de estudiantes')
  })

  it('la asistencia del personal y la de los estudiantes viven en grupos distintos', () => {
    expect(moduleById('staff-attendance').group).toBe('staff')
    expect(moduleById('student-attendance').group).toBe('students')
    // El pase de lista es del docente sobre sus clases: va con lo suyo, no con el personal.
    expect(moduleById('roll-call').group).toBe('mine')
  })
})

describe('qué ve cada uno', () => {
  it('el docente tiene todo lo suyo en "Mi trabajo" y no ve la gestión del personal', () => {
    const groups = visibleNavGroups(teacher)
    expect(groups.map((group) => group.title)).toEqual(['Inicio', 'Mi trabajo', 'Configuración'])
    expect(groups[1].modules.map((entry) => entry.label)).toEqual([
      'Mi agenda',
      'Pase de lista',
      'Mis libretas',
      'Mis asistencias',
      'Mis licencias',
    ])
  })

  it('Dirección ve "Libretas" (todas) y no "Mis libretas"', () => {
    const labels = visibleNavGroups(direccion).flatMap((group) => group.modules.map((entry) => entry.label))
    expect(labels).toContain('Libretas')
    expect(labels).not.toContain('Mis libretas')
    expect(labels).toContain('Asistencia de estudiantes')
    // Con `attendance.read` propio ve sus asistencias, no las del personal.
    expect(labels).toContain('Mis asistencias')
    expect(labels).not.toContain('Asistencia del personal')
  })

  it('un permiso con alcance institucional no muestra la versión "mis…"', () => {
    expect(canSeeModule(admin, moduleById('staff-attendance'))).toBe(true)
    expect(canSeeModule(admin, moduleById('my-attendance'))).toBe(false)
    expect(canSeeModule(null, moduleById('profile'))).toBe(true)
    expect(canSeeModule(null, moduleById('users'))).toBe(false)
  })

  it('acepta la forma vieja de permisos (`permissionIds`, sin alcance) como propia', () => {
    expect(canSeeModule({ permissionIds: ['attendance.read'] }, moduleById('my-attendance'))).toBe(true)
    expect(canSeeModule({ permissionIds: ['attendance.read'] }, moduleById('staff-attendance'))).toBe(false)
  })

  it('el "¿Buscabas…?" sólo ofrece lo que el usuario puede abrir', () => {
    const fromStaff = visibleRelated(admin, moduleById('staff-attendance')).map((related) => related.id)
    expect(fromStaff).toEqual(['student-attendance', 'staff-licenses'])
    const onlyStaff = { permissions: [{ id: 'attendance.read', scope: 'all' as const }] }
    expect(visibleRelated(onlyStaff, moduleById('staff-attendance'))).toEqual([])
  })

  it('los accesos rápidos siguen el orden de Inicio', () => {
    expect(quickAccessModules(teacher).map((entry) => entry.label)).toEqual([
      'Mi agenda',
      'Mis asistencias',
      'Mis licencias',
      'Mis libretas',
      'Pase de lista',
    ])
  })
})
