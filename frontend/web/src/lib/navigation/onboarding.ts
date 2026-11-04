import type { AuthMe } from '@/contexts/AuthContext'
import { hasPermission, permissionScope, type PermissionScope } from '@/lib/auth/permissions'
import { APP_MODULES, canSeeModule, moduleById, visibleModules, visibleNavGroups, visibleRelated, type AppModule, type ModuleId, type VisibleNavGroup } from './modules'
import { navSpot, RELATED_SPOT, SCREEN_SPOTS, type Spot } from './onboarding-spots'

type Capability = { permission: string; text: string; scope?: PermissionScope }
type StepContent = { task: string; instructions: string; capabilities?: Capability[] }

/** Las pantallas vienen del catálogo del menú; las acciones se filtran por separado. */
const CONTENT: Partial<Record<ModuleId, StepContent>> = {
  profile: { task: 'Revisá tu cuenta', instructions: 'Comprobá tus datos de contacto y revisá las opciones de contraseña y verificación en dos pasos.' },
  'my-agenda': { task: 'Ubicá tu próxima clase o turno', instructions: 'Buscá una fecha en tu agenda y abrí un evento para consultar su horario y lugar.' },
  'roll-call': { task: 'Conocé el pase de lista', instructions: 'Elegí una de tus clases y revisá cómo se registra la presencia de cada estudiante. Cuando corresponda pasar lista, guardá el registro de esa clase.' },
  'my-attendance': { task: 'Consultá tus entradas y salidas', instructions: 'Elegí un período y revisá tus marcas y su resumen. Esta es tu asistencia como integrante del personal.' },
  'my-licenses': { task: 'Revisá tus licencias', instructions: 'Consultá las licencias registradas a tu nombre y sus fechas.' },
  messages: { task: 'Encontrá cómo comunicarte', instructions: 'Abrí Mensajes y ubicá el buscador del personal y tus conversaciones. También podés entrar desde el ícono junto a la campana.' },
  'staff-attendance': {
    task: 'Revisá la asistencia del personal', instructions: 'Elegí un período y una persona para consultar sus entradas, salidas e incidencias.',
    capabilities: [
      { permission: 'attendance.update', scope: 'all', text: 'Corregir marcas e incidencias del personal.' },
      { permission: 'exports.create', scope: 'all', text: 'Exportar la asistencia y las novedades para sueldos.' },
    ],
  },
  'staff-licenses': {
    task: 'Consultá las licencias del centro', instructions: 'Buscá una persona y revisá las fechas y el tipo de sus licencias.',
    capabilities: [
      { permission: 'licenses.create', scope: 'all', text: 'Registrar una licencia con sus fechas y motivo.' },
      { permission: 'licenses.update', scope: 'all', text: 'Actualizar las licencias registradas.' },
    ],
  },
  agenda: {
    task: 'Explorá el horario del centro', instructions: 'Elegí un día y abrí una clase, reunión o turno para consultar sus participantes y horario.',
    capabilities: [
      { permission: 'events.create', scope: 'all', text: 'Crear clases, reuniones y turnos con sus participantes.' },
      { permission: 'events.update', scope: 'all', text: 'Actualizar horarios y asignaciones.' },
      { permission: 'student-attendance.take', scope: 'all', text: 'Abrir una clase para registrar el pase de lista de estudiantes.' },
    ],
  },
  users: {
    task: 'Encontrá una cuenta del personal', instructions: 'Usá el buscador y abrí una cuenta para consultar su estado y perfil.',
    capabilities: [
      { permission: 'users.create', scope: 'all', text: 'Crear cuentas del personal.' },
      { permission: 'users.update', scope: 'all', text: 'Editar datos y gestionar las solicitudes de acceso.' },
      { permission: 'users.security', scope: 'all', text: 'Gestionar bloqueos y restablecimientos de contraseña.' },
    ],
  },
  'staff-indicators': { task: 'Leé los indicadores del personal', instructions: 'Elegí un período y revisá los indicadores de puntualidad y ausentismo del personal.' },
  students: {
    task: 'Conocé la matrícula', instructions: 'Buscá un estudiante y revisá su ficha, datos de contacto y acceso al aula virtual.',
    capabilities: [{ permission: 'students.manage', scope: 'all', text: 'Registrar y actualizar los datos de los estudiantes.' }],
  },
  'student-attendance': {
    task: 'Consultá la asistencia de un estudiante', instructions: 'Buscá por nombre, documento o curso y abrí «Ver asistencia». En la ficha, revisá las faltas y llegadas tarde. Usá las fechas y el filtro «Sólo faltas» para encontrar el registro que necesitás.',
    capabilities: [
      { permission: 'student-attendance.justify', scope: 'all', text: 'Agregar licencias o justificativos desde la ficha, con sus fechas y motivo, o justificar una falta desde su registro.' },
      { permission: 'student-attendance.manage', scope: 'all', text: 'Controlar y gestionar las listas de asistencia del centro.' },
    ],
  },
  'student-indicators': {
    task: 'Mirá cómo les va a los estudiantes',
    instructions: 'Empezá por el Resumen y abrí cada sección: rendimiento, materias y APE, asistencia, trayectoria y quién necesita atención. Cada número dice de cuántos sale.',
    capabilities: [{ permission: 'student-attendance.read', scope: 'all', text: 'Abrir la ficha de asistencia del estudiante desde su nombre.' }],
  },
  tuition: {
    task: 'Revisá cuotas y pagos', instructions: 'Elegí un mes y un estudiante para consultar sus cuotas y los pagos registrados.',
    capabilities: [{ permission: 'students.manage', scope: 'all', text: 'Gestionar cuotas y registrar pagos de estudiantes.' }],
  },
  'school-years': { task: 'Ubicá el ciclo lectivo', instructions: 'Revisá los ciclos lectivos y la oferta de cursos. Desde esta pantalla podés gestionar el año que va a usar la institución.' },
  courses: {
    task: 'Conocé los cursos y asignaturas', instructions: 'Seleccioná un ciclo y revisá los cursos, las asignaturas y las orientaciones disponibles.',
    capabilities: [{ permission: 'courses.manage', scope: 'all', text: 'Crear y editar cursos, asignaturas y orientaciones.' }],
  },
  'gradebook-control': {
    task: 'Revisá el control de libretas', instructions: 'Elegí una reunión y revisá los pendientes. En el paso Visado, usá «Revisar» para abrir una libreta y consultar lo que cerró el docente en «Revisión y visado». Desde ahí podés seguir con la siguiente libreta de la reunión.',
    capabilities: [
      { permission: 'gradebook.review', scope: 'all', text: 'Registrar controles y observaciones para el docente.' },
      { permission: 'gradebook.endorse', scope: 'all', text: 'Visar cada libreta desde «Revisión y visado», después de revisar lo que cerró el docente.' },
    ],
  },
  'teachers-meeting': { task: 'Explorá una reunión de profesores', instructions: 'Seleccioná un grupo y una reunión para consultar la matriz de calificaciones y los juicios de los estudiantes.' },
  'gradebook-config': { task: 'Revisá los criterios de evaluación', instructions: 'Ubicá los períodos, las escalas y los tipos de actividad que usan las libretas. Desde aquí podés configurar los criterios de la institución.' },
  settings: { task: 'Conocé los ajustes de la institución', instructions: 'Revisá los datos de la institución, los horarios y las tolerancias. Identificá dónde se configuran los avisos y las integraciones.' },
  profiles: { task: 'Revisá qué puede hacer cada perfil', instructions: 'Seleccioná un perfil y consultá sus permisos y alcances. Desde esta pantalla podés gestionar también los roles personalizados.' },
  audit: { task: 'Consultá la actividad del sistema', instructions: 'Filtrá la auditoría por fecha o usuario y abrí un registro para identificar qué acción se realizó y cuándo.' },
}

const GRADEBOOK_CONTENT: StepContent = {
  task: 'Explorá una libreta',
  instructions: 'Elegí una libreta y ubicá sus estudiantes, evaluaciones, planificación e inasistencias. Las opciones disponibles dependen de tus permisos.',
  capabilities: [
    { permission: 'gradebook.plan', text: 'Cargar planificación y desarrollo de las clases.' },
    { permission: 'gradebook.grade', text: 'Registrar evaluaciones y calificaciones.' },
    { permission: 'gradebook.close', text: 'Completar y cerrar un período cuando corresponda.' },
    { permission: 'gradebook.review', scope: 'all', text: 'Consultar y registrar observaciones de seguimiento.' },
    { permission: 'students.accommodations', scope: 'all', text: 'Cargar adecuaciones desde la hoja del estudiante.' },
    { permission: 'gradebook.export', text: 'Exportar libretas y boletines disponibles.' },
  ],
}

// Primero la cuenta y la preparación del centro; luego el trabajo cotidiano y su seguimiento.
const ORDER: ModuleId[] = [
  'profile', 'school-years', 'courses', 'gradebook-config', 'users', 'students', 'agenda',
  'my-agenda', 'roll-call', 'my-gradebooks', 'gradebooks', 'student-attendance',
  'gradebook-control', 'teachers-meeting', 'student-indicators', 'my-attendance',
  'my-licenses', 'staff-attendance', 'staff-licenses', 'staff-indicators', 'tuition',
  'messages', 'settings', 'profiles', 'audit',
]

export type OnboardingSpot = Omit<Spot, 'permission'>

export type OnboardingStep = StepContent & {
  module: AppModule
  scopeLabel: string
  actions: string[]
  /** Los globos que señalan la pantalla, en orden; los compartidos («¿Buscás…?», el menú) al final. */
  spots: OnboardingSpot[]
}

/** Los globos de la pantalla que le tocan a quien mira, más los compartidos al final. */
function stepSpots(me: AuthMe, entry: AppModule, menu: readonly VisibleNavGroup[]): OnboardingSpot[] {
  const own = (SCREEN_SPOTS[entry.id] ?? []).filter(
    (spot) => !spot.permission || hasPermission(me, spot.permission.id, spot.permission.scope),
  )
  const shared: Spot[] = []
  if (visibleRelated(me, entry).length > 0) shared.push(RELATED_SPOT)
  // Sólo si está en el menú de quien mira: Mensajes se abre por su ícono, y Personal no tiene
  // Configuración aunque pueda abrir Mi perfil.
  const group = menu.find((candidate) => candidate.modules.some((item) => item.id === entry.id))
  if (group) shared.push(navSpot(entry.id, `${group.title} › ${entry.label}`))
  return [...own, ...shared].map(({ target, title, text }) => ({ target, title, text }))
}

export function onboardingSteps(me: AuthMe | null): OnboardingStep[] {
  if (!me) return []
  const modules = visibleModules(me)
  const messages = moduleById('messages')
  if (canSeeModule(me, messages)) modules.push(messages)
  const menu = visibleNavGroups(me)
  return ORDER.flatMap((id) => {
    const entry = modules.find((candidate) => candidate.id === id)
    if (!entry) return []
    const content = id === 'my-gradebooks' || id === 'gradebooks' ? GRADEBOOK_CONTENT : CONTENT[id]
    if (!content) return []
    const ids = typeof entry.permission === 'string' ? [entry.permission] : entry.permission ?? []
    const institutional = entry.group !== 'mine' && ids.some((permission) => permissionScope(me, permission) === 'all')
    return [{
      ...content,
      module: entry,
      scopeLabel: institutional ? 'Toda la institución' : entry.group === 'mine' || id === 'profile' ? 'Tu cuenta y lo asignado a vos' : 'Según tus permisos',
      actions: (content.capabilities ?? [])
        .filter((action) => hasPermission(me, action.permission, action.scope ?? (institutional ? 'all' : 'own')))
        .map((action) => action.text),
      spots: stepSpots(me, entry, menu),
    }]
  })
}

/** Un cambio de rol o permisos inicia un recorrido nuevo; nunca comparte progreso entre cuentas. */
export function onboardingStorageKey(me: AuthMe | null): string | null {
  const identity = me?.id || me?.email || me?.username
  if (!me || !identity) return null
  const ids = [...new Set([...(me.permissionIds ?? []), ...(me.permissions ?? []).map((p) => p.id)])].sort()
  const grants = ids.map((id) => [id, permissionScope(me, id)])
  return `edutrack.onboarding.v1:${JSON.stringify([identity, me.role, grants])}`
}

export function isOnboardingStepPath(pathname: string, step: OnboardingStep): boolean {
  // «Revisar» sale de la bandeja de Control y lleva al visado dentro de la libreta.
  if (/^\/libreta\/[^/]+\/visado\/?$/.test(pathname)) return step.module.id === 'gradebook-control'
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  return matches(step.module.href) && !APP_MODULES.some((entry) =>
    entry.href.length > step.module.href.length && matches(entry.href),
  )
}
