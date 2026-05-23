/** Definición estática de defaults de permisos solo para roles built-in ADMIN / STAFF / TEACHER. */

export const ROLE_LABELS = {
  ADMIN: 'Administrador',
  TEACHER: 'Tutor',
  STAFF: 'Staff',
} as const

/** Claves para las que existe matriz canónica en código (seed). */
export type BuiltinProfileRole = keyof typeof ROLE_LABELS

export type DefaultProfilePermission = {
  id: string
  module: string
  action: string
  label: string
  enabled: boolean
  scope: 'own' | 'all'
}

function perm(
  id: string,
  module: string,
  action: string,
  label: string,
  enabled: boolean,
  scope: 'own' | 'all',
): DefaultProfilePermission {
  return { id, module, action, label, enabled, scope }
}

export const DEFAULT_PROFILE_PERMISSIONS: Record<BuiltinProfileRole, readonly DefaultProfilePermission[]> = {
  ADMIN: [
    perm('users.read', 'Usuarios', 'read', 'Ver usuarios', true, 'all'),
    perm('users.create', 'Usuarios', 'create', 'Crear usuarios', true, 'all'),
    perm('users.update', 'Usuarios', 'update', 'Editar usuarios', true, 'all'),
    perm('users.security', 'Usuarios', 'security', 'Bloquear usuarios y resetear contraseñas', true, 'all'),
    perm('attendance.read', 'Asistencias', 'read', 'Ver asistencias', true, 'all'),
    perm('attendance.update', 'Asistencias', 'update', 'Editar asistencias', true, 'all'),
    perm('attendance.delete', 'Asistencias', 'delete', 'Eliminar asistencias', true, 'all'),
    perm('attendance.biometric', 'Asistencias', 'biometric', 'Registrar asistencia biométrica', true, 'all'),
    perm('events.read', 'Eventos', 'read', 'Ver eventos', true, 'all'),
    perm('events.create', 'Eventos', 'create', 'Crear eventos', true, 'all'),
    perm('events.update', 'Eventos', 'update', 'Editar eventos', true, 'all'),
    perm('events.cancel', 'Eventos', 'cancel', 'Cancelar eventos', true, 'all'),
    perm('events.delete', 'Eventos', 'delete', 'Eliminar eventos', true, 'all'),
    perm('licenses.read', 'Licencias', 'read', 'Ver licencias', true, 'all'),
    perm('licenses.create', 'Licencias', 'create', 'Crear licencias', true, 'all'),
    perm('licenses.update', 'Licencias', 'update', 'Editar licencias', true, 'all'),
    perm('licenses.delete', 'Licencias', 'delete', 'Desactivar licencias', true, 'all'),
    perm('analytics.read', 'Analytics', 'read', 'Ver analytics', true, 'all'),
    perm('reports.read', 'Reportes', 'read', 'Ver reportes', true, 'all'),
    perm('exports.create', 'Exportaciones', 'create', 'Crear exportaciones', true, 'all'),
    perm('school-years.manage', 'Ciclos lectivos', 'manage', 'Gestionar ciclos lectivos', true, 'all'),
    perm('courses.manage', 'Cursos', 'manage', 'Gestionar cursos y materias', true, 'all'),
    perm('students.manage', 'Estudiantes', 'manage', 'Gestionar estudiantes', true, 'all'),
    perm('settings.manage', 'Configuración', 'manage', 'Gestionar configuración del sistema', true, 'all'),
    perm('audit.read', 'Auditoría', 'read', 'Ver auditoría', true, 'all'),
    perm('query-assistant.use', 'Consultas', 'use', 'Usar asistente de consultas', true, 'all'),
    perm('profiles.manage', 'Perfiles', 'manage', 'Gestionar perfiles', true, 'all'),
  ],
  TEACHER: [
    perm('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    perm('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
  ],
  STAFF: [
    perm('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    perm('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
  ],
} as const

export const REMOVED_PROFILE_PERMISSION_IDS: Record<BuiltinProfileRole, Set<string>> = {
  ADMIN: new Set(['licenses.approve']),
  TEACHER: new Set(['attendance.create', 'events.create', 'events.update', 'licenses.create']),
  STAFF: new Set(['attendance.create', 'licenses.create']),
}

export function normalizePermissionId(module: string, action: string) {
  const clean = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(?:^-|-$)/g, '')
  return `${clean(module)}.${clean(action)}`
}

export function builtinDefaultIds(roleCode: string): Set<string> {
  const row = DEFAULT_PROFILE_PERMISSIONS[roleCode as BuiltinProfileRole]
  if (!row) return new Set()
  return new Set(row.map((p) => p.id))
}

export type ProfilePermissionRow = {
  id: string
  module: string
  action: string
  label: string
  enabled: boolean
  scope: 'own' | 'all'
}

export type ProfilePermissionsByCodeStore = Record<string, ProfilePermissionRow[]>

/** “system” solo si ese permiso está en los defaults coded para roles built-in ADMIN/STAFF/TEACHER. */
export function permissionSourceResolved(roleCode: string, permissionId: string): 'system' | 'custom' {
  return builtinDefaultIds(roleCode).has(permissionId) ? 'system' : 'custom'
}
