/** Definición estática de defaults de permisos de los roles built-in. */

export const ROLE_LABELS = {
  ADMIN: 'Administrador',
  TEACHER: 'Docente',
  STAFF: 'Personal',
  ADSCRIPTO: 'Adscripto',
  DIRECCION: 'Dirección',
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

/**
 * Lo que Dirección y Adscripción ven, igual que Administración: todo el centro, sólo lectura.
 * Crear o editar (usuarios, horario, licencias, cursos, configuración) sigue siendo de
 * Administración, y `exports.create` también: con alcance all abre sueldos y asistencia del personal.
 * Los "Mis …" del menú aceptan alcance all, así que no pierden sus asistencias, agenda ni licencias.
 */
function supervisionReadAll(): DefaultProfilePermission[] {
  return [
    perm('users.read', 'Usuarios', 'read', 'Ver usuarios', true, 'all'),
    perm('attendance.read', 'Asistencia del personal', 'read', 'Ver asistencia del personal', true, 'all'),
    perm('events.read', 'Agenda y clases', 'read', 'Ver eventos', true, 'all'),
    perm('licenses.read', 'Licencias', 'read', 'Ver licencias', true, 'all'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('messaging.use', 'Mensajería', 'use', 'Enviar y recibir mensajes', true, 'own'),
    perm('analytics.read', 'Indicadores del personal', 'read', 'Ver indicadores del personal', true, 'all'),
    perm('reports.read', 'Reportes', 'read', 'Ver reportes', true, 'all'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver libretas del centro', true, 'all'),
    perm('academic-analytics.read', 'Rendimiento académico', 'read', 'Ver rendimiento académico', true, 'all'),
    perm('student-attendance.read', 'Asistencia de estudiantes', 'read', 'Ver el pase de lista del centro', true, 'all'),
    perm('student-reports.read', 'Reportes de estudiantes', 'read', 'Ver reportes y alertas de estudiantes', true, 'all'),
    perm('audit.read', 'Auditoría', 'read', 'Ver auditoría', true, 'all'),
  ]
}

// TEACHER y STAFF ("Personal") ya no comparten matriz: Personal es el funcionario no docente
// (limpieza, administración) y sólo ve sus ingresos y sus licencias.
export const DEFAULT_PROFILE_PERMISSIONS: Record<BuiltinProfileRole, readonly DefaultProfilePermission[]> = {
  ADMIN: [
    perm('users.read', 'Usuarios', 'read', 'Ver usuarios', true, 'all'),
    perm('users.create', 'Usuarios', 'create', 'Crear usuarios', true, 'all'),
    perm('users.update', 'Usuarios', 'update', 'Editar usuarios', true, 'all'),
    perm('users.security', 'Usuarios', 'security', 'Bloquear usuarios y restablecer contraseñas', true, 'all'),
    perm('attendance.read', 'Asistencia del personal', 'read', 'Ver asistencia del personal', true, 'all'),
    perm('attendance.update', 'Asistencia del personal', 'update', 'Editar asistencia del personal', true, 'all'),
    perm('attendance.delete', 'Asistencia del personal', 'delete', 'Eliminar asistencia del personal', true, 'all'),
    perm('attendance.biometric', 'Asistencia del personal', 'biometric', 'Registrar asistencia biométrica', true, 'all'),
    perm('events.read', 'Agenda y clases', 'read', 'Ver eventos', true, 'all'),
    perm('events.create', 'Agenda y clases', 'create', 'Crear eventos', true, 'all'),
    perm('events.update', 'Agenda y clases', 'update', 'Editar eventos', true, 'all'),
    perm('events.cancel', 'Agenda y clases', 'cancel', 'Cancelar eventos', true, 'all'),
    perm('events.delete', 'Agenda y clases', 'delete', 'Eliminar eventos', true, 'all'),
    perm('licenses.read', 'Licencias', 'read', 'Ver licencias', true, 'all'),
    perm('licenses.create', 'Licencias', 'create', 'Crear licencias', true, 'all'),
    perm('licenses.update', 'Licencias', 'update', 'Editar licencias', true, 'all'),
    perm('licenses.delete', 'Licencias', 'delete', 'Desactivar licencias', true, 'all'),
    perm('analytics.read', 'Indicadores del personal', 'read', 'Ver indicadores del personal', true, 'all'),
    perm('reports.read', 'Reportes', 'read', 'Ver reportes', true, 'all'),
    perm('exports.create', 'Exportaciones', 'create', 'Crear exportaciones', true, 'all'),
    perm('school-years.manage', 'Ciclos lectivos', 'manage', 'Gestionar ciclos lectivos', true, 'all'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('courses.manage', 'Cursos', 'manage', 'Gestionar cursos y materias', true, 'all'),
    perm('students.manage', 'Estudiantes', 'manage', 'Gestionar estudiantes', true, 'all'),
    perm('students.accommodations', 'Estudiantes', 'accommodations', 'Cargar adecuaciones', true, 'all'),
    perm('academic-config.manage', 'Configuración académica', 'manage', 'Gestionar escalas, períodos y tipos de actividad', true, 'all'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver libretas', true, 'all'),
    // Sin `gradebook.grade`, `gradebook.plan` ni `gradebook.close`: la libreta es del docente.
    // Administración la ve, reabre un período si hay que corregir y le escribe; no carga por él.
    perm('gradebook.review', 'Libreta', 'review', 'Controlar libretas y registrar observaciones', true, 'all'),
    perm('gradebook.endorse', 'Libreta', 'endorse', 'Visar libretas', true, 'all'),
    perm('gradebook.inspect', 'Libreta', 'inspect', 'Consultar libretas y registrar visitas de inspección', true, 'all'),
    perm('gradebook.manage', 'Libreta', 'manage', 'Reabrir períodos cerrados (con motivo)', true, 'all'),
    perm('gradebook.export', 'Libreta', 'export', 'Exportar libretas y boletines', true, 'all'),
    perm('academic-analytics.read', 'Rendimiento académico', 'read', 'Ver rendimiento académico', true, 'all'),
    perm('student-reports.read', 'Reportes de estudiantes', 'read', 'Ver reportes y alertas de estudiantes', true, 'all'),
    perm('student-attendance.take', 'Asistencia de estudiantes', 'take', 'Pasar lista de clases', true, 'all'),
    perm('student-attendance.read', 'Asistencia de estudiantes', 'read', 'Ver pase de lista', true, 'all'),
    perm('student-attendance.justify', 'Asistencia de estudiantes', 'justify', 'Justificar faltas y fijar media falta', true, 'all'),
    perm('student-attendance.manage', 'Asistencia de estudiantes', 'manage', 'Controlar y justificar el pase de lista', true, 'all'),
    perm('settings.manage', 'Configuración', 'manage', 'Gestionar configuración del sistema', true, 'all'),
    perm('audit.read', 'Auditoría', 'read', 'Ver auditoría', true, 'all'),
    perm('profiles.manage', 'Perfiles', 'manage', 'Gestionar perfiles', true, 'all'),
    perm('messaging.use', 'Mensajería', 'use', 'Enviar y recibir mensajes', true, 'own'),
  ],
  TEACHER: [
    perm('attendance.read', 'Asistencia del personal', 'read', 'Ver mis asistencias', true, 'own'),
    perm('events.read', 'Agenda y clases', 'read', 'Ver mis eventos', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('messaging.use', 'Mensajería', 'use', 'Enviar y recibir mensajes', true, 'own'),
    perm('courses.read', 'Cursos', 'read', 'Ver cursos y materias', true, 'all'),
    perm('student-attendance.take', 'Asistencia de estudiantes', 'take', 'Pasar lista de mis clases', true, 'own'),
    perm('student-attendance.read', 'Asistencia de estudiantes', 'read', 'Ver el pase de lista de mis clases', true, 'own'),
    perm('gradebook.read', 'Libreta', 'read', 'Ver mis libretas', true, 'own'),
    perm('gradebook.grade', 'Libreta', 'grade', 'Calificar en mis libretas', true, 'own'),
    perm('gradebook.plan', 'Libreta', 'plan', 'Planificar mis libretas', true, 'own'),
    perm('gradebook.close', 'Libreta', 'close', 'Cerrar los períodos de mis libretas', true, 'own'),
    perm('gradebook.export', 'Libreta', 'export', 'Exportar mis libretas', true, 'own'),
  ],
  // Personal: funcionario no docente. Sus ingresos (marcas) y sus licencias; nada académico.
  STAFF: [
    perm('attendance.read', 'Asistencia del personal', 'read', 'Ver mis asistencias', true, 'own'),
    perm('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
    perm('messaging.use', 'Mensajería', 'use', 'Enviar y recibir mensajes', true, 'own'),
  ],
  // Adscripto: ve todo el centro como Administración; controla el avance de las libretas y
  // justifica faltas, pero NO visa.
  ADSCRIPTO: [
    ...supervisionReadAll(),
    perm('gradebook.review', 'Libreta', 'review', 'Controlar libretas y registrar observaciones', true, 'all'),
    // Libretas y boletines van con un permiso propio y no con `exports.create`: ese, con alcance
    // all, abre también `/exports`, donde están la asistencia del personal y las novedades de sueldos.
    perm('gradebook.export', 'Libreta', 'export', 'Exportar libretas y boletines', true, 'all'),
    // Justificar es trabajo de adscripción, no del docente. Se le da el permiso acotado y no
    // `student-attendance.manage`, que además habilita reabrir listas ya cerradas.
    perm('student-attendance.justify', 'Asistencia de estudiantes', 'justify', 'Justificar faltas y fijar media falta', true, 'all'),
    // Adecuaciones sin `students.manage`: las carga desde la hoja del alumno en la libreta.
    perm('students.accommodations', 'Estudiantes', 'accommodations', 'Cargar adecuaciones', true, 'all'),
  ],
  // Dirección: ve todo el centro como Administración y es el único rol con `gradebook.endorse`.
  // Ese permiso, y no un `if` en una ruta, es lo que cumple la nota funcional del pliego ("el
  // visado formal corresponde al rol Director").
  //
  // Sin `gradebook.grade`, `gradebook.close` ni `gradebook.plan`: el director ve la libreta del
  // docente, la visa y le deja mensajes, pero no la edita. Si algo está mal cargado se lo avisa.
  DIRECCION: [
    ...supervisionReadAll(),
    perm('gradebook.review', 'Libreta', 'review', 'Controlar libretas y registrar observaciones', true, 'all'),
    perm('gradebook.export', 'Libreta', 'export', 'Exportar libretas y boletines', true, 'all'),
    perm('gradebook.endorse', 'Libreta', 'endorse', 'Visar libretas', true, 'all'),
    // En ciclo básico dirección también justifica faltas, previa o posteriormente. Igual que
    // adscripción: el permiso acotado, sin `manage`.
    perm('student-attendance.justify', 'Asistencia de estudiantes', 'justify', 'Justificar faltas y fijar media falta', true, 'all'),
    // Adecuaciones sin `students.manage`: las carga desde la hoja del alumno en la libreta.
    perm('students.accommodations', 'Estudiantes', 'accommodations', 'Cargar adecuaciones', true, 'all'),
  ],
} as const

/**
 * Alcances que el arranque **fuerza** en bases existentes. El sync de defaults sólo crea los permisos
 * que faltan (`update: {}`): cambiar el alcance de uno que ya existe en la matriz no llega a
 * producción. Lo que se agregue acá pisa lo que haya en esa fila (habilitado + alcance).
 */
export const ENFORCED_PROFILE_PERMISSION_SCOPES: Partial<Record<BuiltinProfileRole, Readonly<Record<string, 'own' | 'all'>>>> = {
  // Dirección y Adscripción pasaron de ver lo propio a ver todo el centro (20/10/2026).
  DIRECCION: { 'attendance.read': 'all', 'events.read': 'all', 'licenses.read': 'all' },
  ADSCRIPTO: { 'attendance.read': 'all', 'events.read': 'all', 'licenses.read': 'all' },
}

/**
 * Módulos de permisos renombrados para que digan de quién son. "Asistencias" era la del personal y
 * "Pase de lista" incluía justificar faltas de estudiantes: en Roles / Perfiles se confundían igual
 * que en el menú. El arranque renombra también los permisos viejos que ya no están en la matriz
 * (por ejemplo `attendance.create`), que si no quedarían solos bajo el nombre anterior.
 */
export const RENAMED_PERMISSION_MODULES: Readonly<Record<string, string>> = {
  Asistencias: 'Asistencia del personal',
  'Pase de lista': 'Asistencia de estudiantes',
  Analytics: 'Indicadores del personal',
  'Análisis académico': 'Rendimiento académico',
  Eventos: 'Agenda y clases',
}

/** Lo que Personal (STAFF) tenía cuando compartía la matriz del docente. */
/** Escribir en la libreta: sólo el docente (titular o suplente). */
const ADMIN_GRADEBOOK_EDIT_PERMISSION_IDS = ['gradebook.grade', 'gradebook.plan', 'gradebook.close'] as const

const STAFF_ACADEMIC_PERMISSION_IDS = [
  'events.read',
  'courses.read',
  'student-attendance.take',
  'student-attendance.read',
  'gradebook.read',
  'gradebook.grade',
  'gradebook.plan',
  'gradebook.close',
  'gradebook.export',
] as const

export const REMOVED_PROFILE_PERMISSION_IDS: Record<BuiltinProfileRole, Set<string>> = {
  ADMIN: new Set(['licenses.approve', ...ADMIN_GRADEBOOK_EDIT_PERMISSION_IDS]),
  TEACHER: new Set(['attendance.create', 'events.create', 'events.update', 'licenses.create']),
  STAFF: new Set(['attendance.create', 'licenses.create', ...STAFF_ACADEMIC_PERMISSION_IDS]),
  ADSCRIPTO: new Set(),
  DIRECCION: new Set(['gradebook.plan']),
}

/**
 * Permisos que además de dejar de sembrarse hay que **apagar** en bases que ya los tienen.
 *
 * `REMOVED_PROFILE_PERMISSION_IDS` sólo deja de sembrar y oculta el permiso en la pantalla de
 * perfiles; la autorización lee la base, así que una fila vieja seguiría habilitada. Va aparte y
 * explícito porque apagar un permiso en producción cambia lo que alguien puede hacer hoy.
 */
export const REVOKED_PROFILE_PERMISSION_IDS: Partial<Record<BuiltinProfileRole, readonly string[]>> = {
  // El director ve la libreta y avisa al docente, pero no la edita (ni planificación ni desarrollo).
  DIRECCION: ['gradebook.plan'],
  // Personal no es docente: sin agenda de clases, cursos, pase de lista ni libretas (20/10/2026).
  STAFF: STAFF_ACADEMIC_PERMISSION_IDS,
  // Administración ve la libreta del docente pero no la edita: ni notas, ni juicios, ni cierres,
  // ni planificación (21/10/2026). Conserva `gradebook.manage` para reabrir un período.
  ADMIN: ADMIN_GRADEBOOK_EDIT_PERMISSION_IDS,
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
