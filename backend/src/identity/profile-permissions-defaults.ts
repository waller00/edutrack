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
    // Administración edita todo, también la libreta del docente: notas, C y R, juicios,
    // planificación, desarrollo y cierre. Lo que escribe quien no es el docente queda auditado
    // como corrección (`periodGradeOrigin`, `isSupervisorWrite`).
    perm('gradebook.grade', 'Libreta', 'grade', 'Calificar en las libretas', true, 'all'),
    perm('gradebook.plan', 'Libreta', 'plan', 'Planificar y registrar el desarrollo en las libretas', true, 'all'),
    perm('gradebook.close', 'Libreta', 'close', 'Cerrar los períodos de las libretas', true, 'all'),
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
    perm('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
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
  // Adscripto: ve todo el centro como Administración; controla y observa las libretas y justifica
  // faltas, pero NO visa ni edita la libreta del docente.
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
  // Sin `gradebook.grade`, `gradebook.close`, `gradebook.plan` ni `gradebook.manage` (se apagan en
  // `REVOKED_PROFILE_PERMISSION_IDS`): el director ve la libreta del docente y la visa, pero no la
  // edita. Si algo está mal cargado, lo observa o le escribe.
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

/** Un permiso que el arranque deja prendido, con su alcance, y por qué. */
export type EnforcedGrant = { scope: 'own' | 'all'; reason: string }

function enforce(ids: readonly string[], scope: 'own' | 'all', reason: string): Record<string, EnforcedGrant> {
  return Object.fromEntries(ids.map((id) => [id, { scope, reason }]))
}

function revoke(ids: readonly string[], reason: string): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, reason]))
}

/** Escribir en la libreta: notas, C y R, juicios, planificación, desarrollo y cierre. */
const GRADEBOOK_EDIT_PERMISSION_IDS = ['gradebook.grade', 'gradebook.plan', 'gradebook.close'] as const

/** Lo que la supervisión no hace sobre la libreta del docente: tampoco reabrir un período. */
const SUPERVISION_GRADEBOOK_WRITE_IDS = [...GRADEBOOK_EDIT_PERMISSION_IDS, 'gradebook.manage'] as const

const SUPERVISION_SEES_ALL_IDS = ['attendance.read', 'events.read', 'licenses.read'] as const

/**
 * Permisos que el arranque **fuerza** en bases existentes, con su alcance. El sync de defaults sólo
 * crea los permisos que faltan (`update: {}`): cambiar el alcance de uno que ya existe en la matriz
 * no llega a producción. Lo que se agregue acá pisa lo que haya en esa fila (habilitado + alcance),
 * y en Roles / Perfiles se muestra fijo, con su motivo: si no, el cambio se perdía al arrancar.
 */
export const ENFORCED_PROFILE_PERMISSION_SCOPES: Partial<Record<BuiltinProfileRole, Readonly<Record<string, EnforcedGrant>>>> = {
  // Administración edita todo, también la libreta (25/10/2026). Hasta entonces se le apagaba.
  ADMIN: {
    ...enforce(GRADEBOOK_EDIT_PERMISSION_IDS, 'all', 'Administración edita todo, también las libretas.'),
    ...enforce(['notifications.read'], 'own', 'Todos los perfiles ven sus propios avisos.'),
  },
  // Dirección y Adscripción pasaron de ver lo propio a ver todo el centro (20/10/2026).
  DIRECCION: enforce(SUPERVISION_SEES_ALL_IDS, 'all', 'Dirección ve todo el centro, como Administración.'),
  ADSCRIPTO: enforce(SUPERVISION_SEES_ALL_IDS, 'all', 'Adscripción ve todo el centro, como Administración.'),
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

/**
 * Permisos que dejaron de ser de un perfil: no se siembran y no se pueden prender desde Roles /
 * Perfiles. Si una base vieja todavía los tiene prendidos, la pantalla los muestra (la autorización
 * los usa) y se pueden apagar; apagados, quedan fijos.
 */
export const REMOVED_PROFILE_PERMISSION_IDS: Record<BuiltinProfileRole, Set<string>> = {
  ADMIN: new Set(),
  TEACHER: new Set(['attendance.create', 'events.create', 'events.update', 'licenses.create']),
  STAFF: new Set(['attendance.create', 'licenses.create', ...STAFF_ACADEMIC_PERMISSION_IDS]),
  ADSCRIPTO: new Set(),
  DIRECCION: new Set(['gradebook.plan']),
}

/** Motivo de un permiso que ya no es del perfil y está apagado. */
export const REMOVED_PERMISSION_REASON = 'No corresponde a este perfil.'

/**
 * Permisos que además de dejar de sembrarse hay que **apagar** en bases que ya los tienen, con su
 * motivo. La autorización lee la base, así que una fila vieja seguiría habilitada. Va aparte y
 * explícito porque apagar un permiso en producción cambia lo que alguien puede hacer hoy; en Roles /
 * Perfiles se muestran fijos, apagados y con el motivo.
 */
export const REVOKED_PROFILE_PERMISSION_IDS: Partial<Record<BuiltinProfileRole, Readonly<Record<string, string>>>> = {
  // Dirección y Adscripción ven la libreta del docente; Dirección la visa y Adscripción la observa.
  // Ninguna la edita ni reabre sus períodos (25/10/2026).
  DIRECCION: revoke(SUPERVISION_GRADEBOOK_WRITE_IDS, 'Dirección ve las libretas y las visa; no las edita.'),
  ADSCRIPTO: revoke(SUPERVISION_GRADEBOOK_WRITE_IDS, 'Adscripción ve las libretas y las observa; no las edita.'),
  // Personal no es docente: sin agenda de clases, cursos, pase de lista ni libretas (20/10/2026).
  STAFF: revoke(STAFF_ACADEMIC_PERMISSION_IDS, 'Personal sólo ve sus asistencias y sus licencias.'),
}

/**
 * Permisos que ninguna ruta consulta. No se ofrecen en Roles / Perfiles (prenderlos no hacía
 * nada) y el arranque los apaga en todos los perfiles.
 */
export const RETIRED_PERMISSION_CODES: readonly string[] = ['licenses.approve', 'attendance.biometric']

/** Un permiso que el sistema fija en un perfil: Roles / Perfiles lo muestra y no deja cambiarlo. */
export type PermissionLock = { enabled: boolean; scope: 'own' | 'all' | null; reason: string }

/** Lo que la política fija sin mirar la base: un permiso que el arranque fuerza o apaga. */
export function policyLockFor(roleCode: string, permissionId: string): PermissionLock | null {
  const role = roleCode as BuiltinProfileRole
  const enforced = ENFORCED_PROFILE_PERMISSION_SCOPES[role]?.[permissionId]
  if (enforced) return { enabled: true, scope: enforced.scope, reason: enforced.reason }
  const revoked = REVOKED_PROFILE_PERMISSION_IDS[role]?.[permissionId]
  if (revoked) return { enabled: false, scope: null, reason: revoked }
  return null
}

/**
 * Permisos fijos de un perfil del sistema: los que la política fuerza o apaga, y los que dejaron de
 * ser del perfil y ya están apagados (`enabledIds` son los que hoy están prendidos). Un perfil
 * personalizado no tiene permisos fijos.
 */
export function permissionLocksFor(roleCode: string, enabledIds: ReadonlySet<string>): Map<string, PermissionLock> {
  const role = roleCode as BuiltinProfileRole
  const ids = new Set([
    ...(REMOVED_PROFILE_PERMISSION_IDS[role] ?? []),
    ...Object.keys(REVOKED_PROFILE_PERMISSION_IDS[role] ?? {}),
    ...Object.keys(ENFORCED_PROFILE_PERMISSION_SCOPES[role] ?? {}),
  ])
  const locks = new Map<string, PermissionLock>()
  for (const id of ids) {
    const lock =
      policyLockFor(roleCode, id) ??
      (enabledIds.has(id) ? null : { enabled: false, scope: null, reason: REMOVED_PERMISSION_REASON })
    if (lock) locks.set(id, lock)
  }
  return locks
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
