import {
  BarChart3,
  BookMarked,
  BookOpen,
  Briefcase,
  CalendarDays,
  CalendarRange,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  FileText,
  GraduationCap,
  History,
  LayoutDashboard,
  MessageCircle,
  Library,
  Presentation,
  Receipt,
  School,
  Settings,
  Settings2,
  ShieldCheck,
  Stamp,
  TrendingUp,
  UserCheck,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { permissionScope, type PermissionScope, type WithPermissions } from '@/lib/auth/permissions'

/**
 * Catálogo de módulos: el nombre, la descripción, el ícono y el permiso de cada sección salen de
 * acá. Lo usan el menú lateral, los accesos de Inicio, el encabezado de cada pantalla y la Guía,
 * así nunca dicen cosas distintas (antes el menú y el Inicio tenían cada uno su lista, y ya no
 * coincidían).
 *
 * Regla: ninguna etiqueta dice "asistencia" o "control" sin decir de quién. Hay dos asistencias
 * que no se mezclan: la del **personal** (docentes y funcionarios, `Attendance`) y la de los
 * **estudiantes** (pase de lista). Quien no conoce el sistema no tiene por qué adivinar cuál es.
 */

export type NavGroupId = 'inicio' | 'mine' | 'staff' | 'students' | 'academic' | 'gradebooks' | 'config'

export type ModuleId =
  | 'home'
  | 'guide'
  | 'my-agenda'
  | 'roll-call'
  | 'my-gradebooks'
  | 'my-attendance'
  | 'my-licenses'
  | 'messages'
  | 'staff-attendance'
  | 'staff-licenses'
  | 'agenda'
  | 'users'
  | 'staff-indicators'
  | 'students'
  | 'student-attendance'
  | 'tuition'
  | 'school-years'
  | 'courses'
  | 'gradebooks'
  | 'gradebook-control'
  | 'gradebook-endorsement'
  | 'teachers-meeting'
  | 'academic-performance'
  | 'gradebook-config'
  | 'profile'
  | 'settings'
  | 'profiles'
  | 'audit'

/** Una sección que se confunde con esta: el encabezado ofrece "¿Buscabas…?" con su enlace. */
export type RelatedModule = { id: ModuleId; text: string }

export type AppModule = {
  id: ModuleId
  label: string
  href: string
  /** Para qué sirve, en una línea. Se muestra en el encabezado, en Inicio y en la Guía. */
  description: string
  group: NavGroupId
  icon: LucideIcon
  permission?: string | readonly string[]
  /** `own`: sólo quien lo tiene sobre lo propio; `all`: sólo con alcance institucional. */
  permissionScope?: PermissionScope
  related?: readonly RelatedModule[]
  /** Orden en los accesos rápidos de Inicio; sin él, el módulo no aparece ahí. */
  quickAccess?: number
}

export type NavGroupMeta = {
  title: string
  icon: LucideIcon
  /** Qué hay en el grupo; lo usa la Guía. */
  description: string
  /** El encabezado de cada pantalla muestra el grupo, salvo en Inicio. */
  showChip: boolean
}

export const NAV_GROUP_ORDER: readonly NavGroupId[] = [
  'inicio',
  'mine',
  'staff',
  'students',
  'academic',
  'gradebooks',
  'config',
]

export const NAV_GROUP_META: Record<NavGroupId, NavGroupMeta> = {
  inicio: {
    title: 'Inicio',
    icon: LayoutDashboard,
    description: 'El resumen del día y esta guía.',
    showChip: false,
  },
  mine: {
    title: 'Mi trabajo',
    icon: Briefcase,
    description: 'Lo tuyo: tu agenda, el pase de lista de tus clases, tus libretas, tu asistencia y tus licencias.',
    showChip: true,
  },
  staff: {
    title: 'Personal',
    icon: Users,
    description: 'Docentes y funcionarios: su asistencia, sus licencias, sus horarios y sus cuentas.',
    showChip: true,
  },
  students: {
    title: 'Estudiantes',
    icon: GraduationCap,
    description: 'La matrícula, la asistencia y las mensualidades de los estudiantes.',
    showChip: true,
  },
  academic: {
    title: 'Académico',
    icon: School,
    description: 'Cómo se organiza cada año: ciclos lectivos, cursos y asignaturas.',
    showChip: true,
  },
  gradebooks: {
    title: 'Libretas',
    icon: BookMarked,
    description: 'Las calificaciones de cada grupo y su seguimiento: control, visado, reunión y rendimiento.',
    showChip: true,
  },
  config: {
    title: 'Configuración',
    icon: Settings,
    description: 'Tu perfil y, si te corresponde, los ajustes del sistema.',
    showChip: true,
  },
}

const STUDENT_ATTENDANCE_PERMISSIONS = [
  'student-attendance.justify',
  'student-attendance.manage',
  'student-reports.read',
] as const

export const APP_MODULES: readonly AppModule[] = [
  // Inicio
  {
    id: 'home',
    label: 'Inicio',
    href: '/',
    description: 'Lo esencial del día y lo que necesita tu atención.',
    group: 'inicio',
    icon: LayoutDashboard,
  },
  {
    id: 'guide',
    label: 'Guía',
    href: '/guia',
    description: 'Qué hace cada sección del menú y en qué se diferencian las que se parecen.',
    group: 'inicio',
    icon: CircleHelp,
  },

  // Mi trabajo: lo propio de cada docente o funcionario. Mi agenda, Mis asistencias y Mis licencias
  // no fijan alcance: Dirección y Adscripción ven las de todos y siguen teniendo las suyas (las
  // páginas consultan `my-*`, que filtran por quien está en la sesión).
  {
    id: 'my-agenda',
    label: 'Mi agenda',
    href: '/me/events',
    description: 'Tus clases, turnos y reuniones asignados.',
    group: 'mine',
    icon: CalendarDays,
    permission: 'events.read',
    quickAccess: 1,
  },
  {
    id: 'roll-call',
    label: 'Pase de lista',
    href: '/me/roll-call',
    description: 'Marcá qué estudiantes vinieron a cada una de tus clases.',
    group: 'mine',
    icon: ClipboardCheck,
    permission: 'student-attendance.take',
    permissionScope: 'own',
    related: [
      { id: 'my-attendance', text: '¿Buscás tu propia entrada y salida?' },
      { id: 'my-gradebooks', text: 'Las faltas acumuladas de cada grupo están en su libreta:' },
    ],
    quickAccess: 6,
  },
  {
    id: 'my-gradebooks',
    label: 'Mis libretas',
    href: '/libreta',
    description: 'Tus grupos: planificación, calificaciones, faltas y cierre de cada período.',
    group: 'mine',
    icon: BookOpen,
    permission: 'gradebook.read',
    permissionScope: 'own',
    quickAccess: 5,
  },
  {
    id: 'my-attendance',
    label: 'Mis asistencias',
    href: '/me/attendance',
    description: 'Tus propias entradas y salidas como docente o funcionario, y el resumen del período.',
    group: 'mine',
    icon: UserCheck,
    permission: 'attendance.read',
    related: [{ id: 'roll-call', text: '¿Buscás las faltas de tus estudiantes?' }],
    quickAccess: 2,
  },
  {
    id: 'my-licenses',
    label: 'Mis licencias',
    href: '/me/licenses',
    description: 'Las licencias registradas a tu nombre.',
    group: 'mine',
    icon: FileText,
    permission: 'licenses.read',
    quickAccess: 3,
  },
  {
    id: 'messages',
    label: 'Mensajes',
    href: '/mensajes',
    description: 'Conversaciones privadas con cualquier persona del personal del liceo.',
    group: 'mine',
    icon: MessageCircle,
    permission: 'messaging.use',
    related: [{ id: 'my-gradebooks', text: '¿Buscás lo que Dirección te observó en una libreta? Está en cada libreta:' }],
  },

  // Personal: docentes y funcionarios, vistos por la institución.
  {
    id: 'staff-attendance',
    label: 'Asistencia del personal',
    href: '/admin/attendance',
    description:
      'Entradas, salidas, llegadas tarde y faltas de docentes y funcionarios, con sus incidencias y las novedades para sueldos.',
    group: 'staff',
    icon: UserCheck,
    permission: 'attendance.read',
    permissionScope: 'all',
    related: [
      { id: 'student-attendance', text: '¿Buscás las faltas de los estudiantes?' },
      { id: 'staff-licenses', text: 'Las ausencias con licencia se cargan en' },
    ],
    quickAccess: 2,
  },
  {
    id: 'staff-licenses',
    label: 'Licencias',
    href: '/admin/licenses',
    description: 'Licencias del personal y días no laborables de la institución.',
    group: 'staff',
    icon: FileText,
    permission: 'licenses.read',
    permissionScope: 'all',
    related: [{ id: 'student-attendance', text: 'Los justificativos de los estudiantes se cargan en' }],
    quickAccess: 3,
  },
  {
    id: 'agenda',
    label: 'Agenda y clases',
    href: '/admin/events',
    description: 'El horario de clases, las reuniones, los turnos y las suplencias del personal.',
    group: 'staff',
    icon: CalendarDays,
    permission: 'events.read',
    permissionScope: 'all',
    quickAccess: 1,
  },
  {
    id: 'users',
    label: 'Usuarios',
    href: '/admin/users',
    description: 'Las cuentas del personal y las solicitudes de acceso.',
    group: 'staff',
    icon: Users,
    permission: 'users.read',
    permissionScope: 'all',
    quickAccess: 12,
  },
  {
    id: 'staff-indicators',
    label: 'Indicadores del personal',
    href: '/admin/analytics',
    description: 'Puntualidad y ausentismo de docentes y funcionarios, y su evolución en el período.',
    group: 'staff',
    icon: BarChart3,
    permission: 'analytics.read',
    related: [{ id: 'academic-performance', text: '¿Buscás las notas y el rendimiento de los estudiantes?' }],
  },

  // Estudiantes.
  {
    id: 'students',
    label: 'Estudiantes',
    href: '/admin/students',
    description: 'La matrícula, los datos de contacto y el acceso al aula virtual de cada estudiante.',
    group: 'students',
    icon: GraduationCap,
    permission: 'students.manage',
    permissionScope: 'all',
    quickAccess: 14,
  },
  {
    id: 'student-attendance',
    label: 'Asistencia de estudiantes',
    href: '/admin/student-attendance',
    description:
      'Justificativos y faltas de estudiantes: quién falta seguido, quién llega a 18 o 25 faltas y las listas sin pasar.',
    group: 'students',
    icon: ClipboardList,
    permission: STUDENT_ATTENDANCE_PERMISSIONS,
    permissionScope: 'all',
    related: [{ id: 'staff-attendance', text: '¿Buscás la asistencia de docentes y funcionarios?' }],
    quickAccess: 11,
  },
  {
    id: 'tuition',
    label: 'Mensualidades',
    href: '/admin/tuition',
    description: 'Las cuotas del mes y los pagos de cada estudiante.',
    group: 'students',
    icon: Receipt,
    permission: 'students.manage',
    permissionScope: 'all',
    quickAccess: 15,
  },

  // Académico.
  {
    id: 'school-years',
    label: 'Ciclos lectivos',
    href: '/admin/school-years',
    description: 'Los años lectivos y la oferta de cursos de cada uno.',
    group: 'academic',
    icon: CalendarRange,
    permission: 'school-years.manage',
    permissionScope: 'all',
    quickAccess: 13,
  },
  {
    id: 'courses',
    label: 'Cursos',
    href: '/admin/courses',
    description: 'Los cursos de cada ciclo, con sus asignaturas y orientaciones.',
    group: 'academic',
    icon: Library,
    permission: ['courses.read', 'courses.manage'],
    quickAccess: 8,
  },

  // Libretas: las calificaciones de los grupos.
  {
    id: 'gradebooks',
    label: 'Libretas',
    href: '/libreta',
    description: 'Las libretas de todos los grupos, para consultarlas y seguirlas.',
    group: 'gradebooks',
    icon: BookOpen,
    permission: 'gradebook.read',
    permissionScope: 'all',
    quickAccess: 5,
  },
  {
    id: 'gradebook-control',
    label: 'Control de libretas',
    href: '/libreta/control',
    description: 'Qué libretas de los docentes están incompletas en cada período, con aviso al docente.',
    group: 'gradebooks',
    icon: FileCheck2,
    permission: 'gradebook.review',
    permissionScope: 'all',
    related: [{ id: 'student-attendance', text: 'Las faltas de los estudiantes se siguen en' }],
    quickAccess: 9,
  },
  {
    id: 'gradebook-endorsement',
    label: 'Visado de libretas',
    href: '/libreta/visado',
    description: 'Los períodos cerrados de cada libreta, para observarlos y visarlos. Visar es de Dirección.',
    group: 'gradebooks',
    icon: Stamp,
    permission: 'gradebook.read',
    permissionScope: 'all',
    quickAccess: 10,
  },
  {
    id: 'teachers-meeting',
    label: 'Reunión de profesores',
    href: '/libreta/reunion',
    description: 'La matriz del grupo para proyectar en la reunión, y el juicio de cada estudiante.',
    group: 'gradebooks',
    icon: Presentation,
    permission: 'gradebook.read',
    permissionScope: 'all',
  },
  {
    id: 'academic-performance',
    label: 'Rendimiento académico',
    href: '/libreta/indicadores',
    description: 'Notas, promedios y alertas de los estudiantes por grupo, asignatura y período.',
    group: 'gradebooks',
    icon: TrendingUp,
    // Con sólo los reportes de estudiantes (adscripción) se ve el seguimiento de notas.
    permission: ['academic-analytics.read', 'student-reports.read'],
    permissionScope: 'all',
    related: [{ id: 'staff-indicators', text: '¿Buscás la puntualidad y el ausentismo del personal?' }],
    quickAccess: 7,
  },
  {
    id: 'gradebook-config',
    label: 'Configuración de libreta',
    href: '/libreta/configuracion',
    description: 'Los períodos, las escalas de calificación y los criterios de las libretas.',
    group: 'gradebooks',
    icon: Settings2,
    permission: 'academic-config.manage',
    permissionScope: 'all',
    quickAccess: 16,
  },

  // Configuración.
  {
    id: 'profile',
    label: 'Mi perfil',
    href: '/profile',
    description: 'Tus datos, tu contraseña y la verificación en dos pasos.',
    group: 'config',
    icon: UserRound,
  },
  {
    id: 'settings',
    label: 'Configuración del sistema',
    href: '/admin/settings',
    description: 'Los ajustes de la institución: horarios, tolerancias, avisos e integraciones.',
    group: 'config',
    icon: Settings,
    permission: 'settings.manage',
    permissionScope: 'all',
    quickAccess: 17,
  },
  {
    id: 'profiles',
    label: 'Roles / Perfiles',
    href: '/admin/profiles',
    description: 'Qué puede ver y hacer cada perfil de usuario.',
    group: 'config',
    icon: ShieldCheck,
    permission: 'profiles.manage',
    permissionScope: 'all',
  },
  {
    id: 'audit',
    label: 'Auditoría',
    href: '/admin/audit',
    description: 'Quién hizo qué y cuándo en el sistema.',
    group: 'config',
    icon: History,
    permission: 'audit.read',
    permissionScope: 'all',
  },
]

const BY_ID = new Map<ModuleId, AppModule>(APP_MODULES.map((entry) => [entry.id, entry]))

export function moduleById(id: ModuleId): AppModule {
  const entry = BY_ID.get(id)
  if (!entry) throw new Error(`Módulo desconocido: ${id}`)
  return entry
}

/**
 * ¿El usuario puede abrir este módulo? Con `permissionScope` el alcance tiene que ser ése y no
 * otro: "Mis libretas" es de quien ve sólo lo propio; quien ve todo tiene "Libretas".
 */
export function canSeeModule(
  me: WithPermissions,
  entry: Pick<AppModule, 'permission' | 'permissionScope'>,
): boolean {
  if (!entry.permission) return true
  const ids = typeof entry.permission === 'string' ? [entry.permission] : entry.permission
  return ids.some((id) => {
    const scope = permissionScope(me, id)
    if (!scope) return false
    return !entry.permissionScope || scope === entry.permissionScope
  })
}

export function visibleModules(me: WithPermissions): AppModule[] {
  return APP_MODULES.filter((entry) => canSeeModule(me, entry))
}

export type VisibleNavGroup = NavGroupMeta & { id: NavGroupId; modules: AppModule[] }

/** Los grupos del menú con lo que el usuario puede abrir; sin grupos vacíos. */
export function visibleNavGroups(me: WithPermissions): VisibleNavGroup[] {
  const modules = visibleModules(me)
  return NAV_GROUP_ORDER.map((id) => ({
    id,
    ...NAV_GROUP_META[id],
    modules: modules.filter((entry) => entry.group === id),
  })).filter((group) => group.modules.length > 0)
}

/** Accesos rápidos de Inicio, en su orden. */
export function quickAccessModules(me: WithPermissions): AppModule[] {
  return visibleModules(me)
    .filter((entry) => entry.quickAccess !== undefined)
    .sort((a, b) => (a.quickAccess ?? 0) - (b.quickAccess ?? 0))
}

/** Las secciones parecidas que el usuario puede abrir, para el "¿Buscabas…?" del encabezado. */
export function visibleRelated(me: WithPermissions, entry: AppModule): Array<RelatedModule & { target: AppModule }> {
  return (entry.related ?? [])
    .map((related) => ({ ...related, target: moduleById(related.id) }))
    .filter((related) => canSeeModule(me, related.target))
}
