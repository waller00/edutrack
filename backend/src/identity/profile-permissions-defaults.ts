/** Definición estática de defaults de permisos solo para roles built-in ADMIN / STAFF / TEACHER. */

export const ROLE_LABELS = {
  ADMIN: 'Administrador',
  TEACHER: 'Docente',
  STAFF: 'Staff',
  ADSCRIPTO: 'Adscripto',
  DIRECCION: 'Dirección',
  INSPECCION: 'Inspección',
} as const

/** Claves para las que existe matriz canónica en código (seed). */
export type BuiltinProfileRole = keyof typeof ROLE_LABELS

/**
 * Roles que el seed siembra, derivados de `ROLE_LABELS` y no repetidos a mano.
 *
 * Antes esta lista estaba hardcodeada dentro del repositorio, en dos funciones distintas: agregar
 * un rol a la matriz no lo sembraba y el fallo era silencioso (el rol quedaba sin ningún permiso).
 */
export const BUILTIN_PROFILE_ROLES = Object.keys(ROLE_LABELS) as BuiltinProfileRole[]

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

// STAFF y TEACHER comparten matriz de permisos a propósito: se mantienen como roles
// separados porque TEACHER se usa para segmentar métricas/reportes docentes, aunque hoy
// puedan hacer lo mismo. No fusionar.
export const DEFAULT_PROFILE_PERMISSIONS: Record<BuiltinProfileRole, readonly DefaultProfilePermission[]> = {
  ADMIN: [
    perm('users.read', 'Usuarios', 'read', 'Ver usuarios', true, 'all'),
    perm('users.create', 'Usuarios', 'create', 'Crear usuarios', true, 'all'),
    perm('users.update', 'Usuarios', 'update', 'Editar usuarios', true, 'all'),
    perm('users.security', 'Usuarios', 'security', 'Bloquear usuarios y restablecer contraseñas', true, 'all'),
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
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('courses.manage', 'Cursos', 'manage', 'Gestionar cursos y materias', true, 'all'),
    perm('students.manage', 'Estudiantes', 'manage', 'Gestionar estudiantes', true, 'all'),
    perm('academic-config.manage', 'Configuración académica', 'manage', 'Gestionar escalas, períodos y tipos de actividad', true, 'all'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver libretas', true, 'all'),
    perm('gradebook.grade', 'Libreta', 'grade', 'Registrar evaluaciones y calificaciones', true, 'all'),
    perm('gradebook.close', 'Libreta', 'close', 'Cerrar períodos y emitir juicios conceptuales', true, 'all'),
    perm('gradebook.review', 'Libreta', 'review', 'Controlar libretas y registrar observaciones', true, 'all'),
    perm('gradebook.endorse', 'Libreta', 'endorse', 'Visar libretas', true, 'all'),
    perm('gradebook.inspect', 'Libreta', 'inspect', 'Consultar libretas y registrar visitas de inspección', true, 'all'),
    perm('gradebook.manage', 'Libreta', 'manage', 'Corregir y reabrir fuera de plazo', true, 'all'),
    perm('academic-analytics.read', 'Análisis académico', 'read', 'Ver indicadores académicos', true, 'all'),
    perm('student-attendance.take', 'Pase de lista', 'take', 'Pasar lista de clases', true, 'all'),
    perm('student-attendance.read', 'Pase de lista', 'read', 'Ver pase de lista', true, 'all'),
    perm('student-attendance.manage', 'Pase de lista', 'manage', 'Controlar y justificar el pase de lista', true, 'all'),
    perm('settings.manage', 'Configuración', 'manage', 'Gestionar configuración del sistema', true, 'all'),
    perm('audit.read', 'Auditoría', 'read', 'Ver auditoría', true, 'all'),
    perm('profiles.manage', 'Perfiles', 'manage', 'Gestionar perfiles', true, 'all'),
  ],
  TEACHER: [
    perm('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    perm('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('student-attendance.take', 'Pase de lista', 'take', 'Pasar lista de mis clases', true, 'own'),
    perm('student-attendance.read', 'Pase de lista', 'read', 'Ver el pase de lista de mis clases', true, 'own'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver mis libretas', true, 'own'),
    perm('gradebook.grade', 'Libreta', 'grade', 'Calificar en mis libretas', true, 'own'),
    perm('gradebook.close', 'Libreta', 'close', 'Cerrar los períodos de mis libretas', true, 'own'),
  ],
  STAFF: [
    perm('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    perm('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('student-attendance.take', 'Pase de lista', 'take', 'Pasar lista de mis clases', true, 'own'),
    perm('student-attendance.read', 'Pase de lista', 'read', 'Ver el pase de lista de mis clases', true, 'own'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver mis libretas', true, 'own'),
    perm('gradebook.grade', 'Libreta', 'grade', 'Calificar en mis libretas', true, 'own'),
    perm('gradebook.close', 'Libreta', 'close', 'Cerrar los períodos de mis libretas', true, 'own'),
  ],
  // Adscripto: controla el avance de las libretas y observa, pero NO visa. Es personal del
  // liceo, así que conserva la línea base "propia" (sus asistencias, eventos y licencias).
  ADSCRIPTO: [
    perm('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    perm('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver libretas del centro', true, 'all'),
    perm('gradebook.review', 'Libreta', 'review', 'Controlar libretas y registrar observaciones', true, 'all'),
  ],
  // Dirección: además de observar, es el único rol con `gradebook.endorse`. Ese permiso, y no un
  // `if` en una ruta, es lo que cumple la nota funcional del pliego ("el visado formal corresponde
  // al rol Director").
  DIRECCION: [
    perm('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    perm('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver libretas del centro', true, 'all'),
    perm('gradebook.review', 'Libreta', 'review', 'Controlar libretas y registrar observaciones', true, 'all'),
    perm('gradebook.endorse', 'Libreta', 'endorse', 'Visar libretas', true, 'all'),
    perm('academic-analytics.read', 'Análisis académico', 'read', 'Ver indicadores académicos', true, 'all'),
  ],
  // Inspección: consulta y observa dentro de su ámbito. Sin `gradebook.endorse` —los visados de
  // Dirección no le son modificables— y sin la línea base "propia", porque no es personal del
  // centro: sus asistencias y licencias no viven acá.
  INSPECCION: [
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver libretas de su ámbito', true, 'all'),
    perm('gradebook.inspect', 'Libreta', 'inspect', 'Registrar visitas de inspección y observaciones', true, 'all'),
    perm('academic-analytics.read', 'Análisis académico', 'read', 'Ver indicadores académicos', true, 'all'),
  ],
} as const

export const REMOVED_PROFILE_PERMISSION_IDS: Record<BuiltinProfileRole, Set<string>> = {
  ADMIN: new Set(['licenses.approve']),
  TEACHER: new Set(['attendance.create', 'events.create', 'events.update', 'licenses.create']),
  STAFF: new Set(['attendance.create', 'licenses.create']),
  ADSCRIPTO: new Set(),
  DIRECCION: new Set(),
  INSPECCION: new Set(),
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
