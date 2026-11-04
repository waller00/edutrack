import type { PermissionScope } from '@/lib/auth/permissions'
import type { ModuleId } from './modules'

/**
 * Los globos del onboarding: cada uno señala un control real de la pantalla (`data-tour`) y dice
 * qué hacer ahí, no qué es. Van en el orden en que se usa la pantalla; los que están en otra vista
 * (la planilla de una clase, la revisión de una libreta) aparecen cuando la persona llega a ella.
 *
 * Un globo con `permission` es de un botón que sólo ve quien puede usarlo. La guardia
 * `onboarding-anchors.test.ts` exige que cada `target` exista en el código.
 */
export type Spot = {
  target: string
  title: string
  text: string
  permission?: { id: string; scope?: PermissionScope }
}

const GRADEBOOK_SPOTS: Spot[] = [
  { target: 'libretas.filters', title: 'Buscá una libreta', text: 'Filtrá por grupo, asignatura o estado.' },
  { target: 'libretas.card', title: 'Las libretas', text: 'Cada tarjeta es un grupo y una asignatura. Abrí una para trabajar en ella.' },
  {
    target: 'libreta.menu',
    title: 'Las secciones de la libreta',
    text: 'Planificación, desarrollo del curso, calificaciones y cierre de períodos, en el orden de la libreta de papel.',
  },
  { target: 'libreta.groups', title: 'Cambiá de grupo', text: 'Pasá a otra libreta sin volver a la lista: quedás en la misma sección.' },
]

export const SCREEN_SPOTS: Partial<Record<ModuleId, Spot[]>> = {
  profile: [
    { target: 'profile.sections', title: 'Tu cuenta en tres partes', text: 'Datos personales, Seguridad y Notificaciones. Pasá de una a otra con estos botones.' },
    { target: 'profile.data', title: 'Tus datos', text: 'Revisá que el correo y el teléfono estén bien: por ahí te llegan los avisos.' },
    {
      target: 'profile.security',
      title: 'Seguridad',
      text: 'Acá cambiás la contraseña, vinculás tu cuenta de Google y cerrás las sesiones abiertas en otros equipos.',
    },
  ],
  'my-agenda': [
    { target: 'my-agenda.period', title: 'Qué fechas ver', text: 'Elegí entre los próximos días o toda tu agenda.' },
    { target: 'my-agenda.event', title: 'Tus clases y turnos', text: 'Cada tarjeta es una actividad tuya, con su horario y su lugar.' },
  ],
  'roll-call': [
    { target: 'roll-call.day', title: 'Elegí el día', text: 'Arranca en hoy. Con las flechas vas a otro día para pasar o corregir una lista.' },
    {
      target: 'roll-call.class',
      title: 'Tus clases del día',
      text: 'Cada clase dice si la lista está abierta, sin pasar o pasada. Tocá una para pasar la lista.',
    },
    { target: 'roll-call.students', title: 'Marcá a cada estudiante', text: 'Presente, ausente o llegada tarde. Si hace falta, agregale una nota.' },
    { target: 'roll-call.options', title: 'Atajos', text: '«Todos presentes» marca a todo el grupo; después cambiás sólo a quien faltó.' },
    {
      target: 'roll-call.save',
      title: 'Guardá la lista',
      text: 'Cuando marcaste a todos, guardá. Podés corregir la lista hasta una semana después de la clase.',
    },
  ],
  'my-gradebooks': GRADEBOOK_SPOTS,
  gradebooks: GRADEBOOK_SPOTS,
  'my-attendance': [
    { target: 'my-attendance.views', title: 'Qué mirar', text: 'El historial de tus marcas o el resumen del período.' },
    { target: 'my-attendance.records', title: 'Tus marcas', text: 'Cada registro es una entrada o salida tuya, con su hora y si hubo alguna incidencia.' },
  ],
  'my-licenses': [
    { target: 'my-licenses.status', title: 'Filtrá por estado', text: 'Todas, sólo las activas o sólo las inactivas.' },
    { target: 'my-licenses.list', title: 'Tus licencias', text: 'Cada tarjeta tiene el tipo de licencia y sus fechas.' },
  ],
  messages: [
    { target: 'messages.contacts', title: 'Buscá a alguien', text: 'Escribí un nombre para encontrar a cualquier persona del personal y escribirle.' },
    { target: 'messages.list', title: 'Tus conversaciones', text: 'Las destacadas van arriba: tocá la estrella de una conversación para tenerla a mano.' },
    { target: 'messages.button', title: 'Desde cualquier pantalla', text: 'Este ícono, al lado de la campana, abre tus mensajes sin salir de lo que estás haciendo.' },
  ],
  'staff-attendance': [
    { target: 'staff-attendance.filters', title: 'Elegí período y persona', text: 'Filtrá las marcas del personal por fechas, persona o clase.' },
    { target: 'staff-attendance.table', title: 'Marcas e incidencias', text: 'Cada fila es una entrada o salida; abrí a una persona para ver su detalle.' },
    {
      target: 'staff-attendance.export',
      title: 'Exportar',
      text: 'Bajá la asistencia o las novedades para liquidar sueldos.',
      permission: { id: 'exports.create', scope: 'all' },
    },
  ],
  'staff-licenses': [
    {
      target: 'staff-licenses.new',
      title: 'Registrá una licencia',
      text: 'Cargá la persona, las fechas y el motivo.',
      permission: { id: 'licenses.create', scope: 'all' },
    },
    { target: 'staff-licenses.filters', title: 'Buscá licencias', text: 'Filtrá por fechas o por persona.' },
    { target: 'staff-licenses.list', title: 'Licencias del personal', text: 'Cada fila tiene la persona, el tipo de licencia y sus fechas.' },
  ],
  agenda: [
    { target: 'agenda.view', title: 'Lista o calendario', text: 'Elegí cómo ver el horario del centro.' },
    { target: 'agenda.filters', title: 'Filtrá la agenda', text: 'Elegí fechas, persona o grupo para encontrar una clase, reunión o turno.' },
    { target: 'agenda.calendar', title: 'El calendario', text: 'Tocá una clase para ver sus participantes, cargar una suplencia o abrir la lista.' },
    {
      target: 'agenda.new',
      title: 'Nueva actividad',
      text: 'Creá una clase, reunión o turno con sus participantes y cuándo se repite.',
      permission: { id: 'events.create', scope: 'all' },
    },
  ],
  users: [
    {
      target: 'users.new',
      title: 'Nuevo usuario',
      text: 'Creá la cuenta de una persona del personal y elegí su perfil.',
      permission: { id: 'users.create', scope: 'all' },
    },
    { target: 'users.search', title: 'Buscá una cuenta', text: 'Escribí un nombre o usá los filtros.' },
    { target: 'users.list', title: 'Las cuentas', text: 'Abrí una para ver su estado, cambiar su perfil o gestionar su acceso.' },
  ],
  'staff-indicators': [
    { target: 'staff-indicators.filters', title: 'Elegí período y personas', text: 'Los indicadores se calculan sobre lo que elijas acá.' },
    { target: 'staff-indicators.views', title: 'Vistas', text: 'Resumen, tendencias y seguimiento de cada persona.' },
    { target: 'staff-indicators.charts', title: 'Puntualidad y ausentismo', text: 'Los indicadores principales del período elegido.' },
  ],
  students: [
    {
      target: 'students.new',
      title: 'Nuevo estudiante',
      text: 'Registrá a un estudiante con sus datos y su matrícula.',
      permission: { id: 'students.manage', scope: 'all' },
    },
    { target: 'students.filters', title: 'Buscá un estudiante', text: 'Por nombre o cédula, y filtrá por curso u orientación.' },
    { target: 'students.table', title: 'La matrícula', text: 'Abrí a un estudiante para ver su ficha, sus contactos y su acceso al aula virtual.' },
  ],
  'student-attendance': [
    {
      target: 'student-attendance.tabs',
      title: 'Qué hacer',
      text: 'Consultar a un estudiante, cargar licencias y justificativos, o ver las listas sin pasar: cada cosa en su pestaña.',
    },
    { target: 'student-attendance.content', title: 'Buscá y abrí', text: 'Buscá al estudiante o elegí el grupo para ver lo de la pestaña elegida.' },
  ],
  'student-indicators': [
    {
      target: 'student-indicators.sections',
      title: 'Las secciones',
      text: 'Resumen, rendimiento, materias y APE, asistencia, trayectoria y quién necesita atención: cada tema en la suya.',
    },
    {
      target: 'student-indicators.filters',
      title: 'Ciclo y boletín',
      text: 'El ciclo es el del menú. Las notas salen del boletín que elijas acá; «Actualizar» vuelve a calcular todo.',
    },
    { target: 'student-indicators.summary', title: 'Lo esencial', text: 'Cuatro números del ciclo, cada uno con de cuántos sale.' },
    {
      target: 'student-indicators.risk',
      title: 'A quién mirar',
      text: 'Quiénes necesitan atención y por qué, por notas y por faltas. La lista completa, con filtros, está en su sección.',
      permission: { id: 'student-reports.read', scope: 'all' },
    },
  ],
  tuition: [
    { target: 'tuition.filters', title: 'Elegí mes y estudiante', text: 'Filtrá por período, nombre o curso.' },
    {
      target: 'tuition.roster',
      title: 'Cuotas del mes',
      text: 'Cada fila dice si la cuota está paga, pendiente o sin registrar. Abrí a un estudiante para registrar un pago.',
    },
  ],
  'school-years': [
    { target: 'school-years.list', title: 'Los ciclos lectivos', text: 'Cada año con su estado. El activo es el que usa todo el sistema.' },
    { target: 'school-years.new', title: 'Nuevo ciclo lectivo', text: 'Se crea cuando el ciclo activo ya está cerrado.' },
  ],
  courses: [
    { target: 'courses.list', title: 'Los cursos', text: 'Elegí un curso para ver sus asignaturas y orientaciones.' },
    { target: 'courses.subjects', title: 'Asignaturas', text: 'Las comunes del curso y las de cada orientación.' },
    {
      target: 'courses.new',
      title: 'Nuevo curso',
      text: 'Creá un curso y ofrecelo en el ciclo activo.',
      permission: { id: 'courses.manage', scope: 'all' },
    },
  ],
  'gradebook-control': [
    { target: 'control.filters', title: 'Reunión y grupo', text: 'Todo lo de abajo es de la reunión y el grupo que elijas acá.' },
    {
      target: 'control.steps',
      title: 'Los tres pasos',
      text: 'Carga (qué falta cargar), Cierre (quién no cerró) y Visado. Cada uno dice cuánto le queda.',
    },
    { target: 'control.review', title: 'Revisá cada libreta', text: 'En Visado, «Revisar» abre la libreta en esa reunión para mirarla antes de decidir.' },
    {
      target: 'visado.review',
      title: 'Lo que cerró el docente',
      text: 'C, R y juicio de cada alumno, el informe del grupo, y lo planificado al lado de lo dictado.',
    },
    { target: 'visado.decision', title: 'Tu decisión', text: 'Visala si está bien, o hacé una observación diciendo sobre qué y qué hay que corregir.' },
    { target: 'visado.next', title: 'Seguí con la próxima', text: 'Te lleva a la siguiente libreta de la reunión que espera revisión.' },
  ],
  'teachers-meeting': [
    { target: 'reunion.filters', title: 'Grupo y reunión', text: 'Elegí qué grupo y qué reunión vas a trabajar.' },
    { target: 'reunion.matrix', title: 'La matriz del grupo', text: 'Las notas de cada alumno en todas las asignaturas, con el promedio como referencia.' },
    { target: 'reunion.performance', title: 'Rendimiento', text: 'Lo elige la reunión para cada alumno: es el que va al boletín.' },
    { target: 'reunion.judgements', title: 'Juicios de la reunión', text: 'El general del grupo queda en la reunión; el de cada alumno va a su boletín.' },
  ],
  'gradebook-config': [
    { target: 'gradebook-config.tabs', title: 'Qué configurar', text: 'Períodos, escalas, tipos de actividad, alertas y libretas.' },
    { target: 'gradebook-config.content', title: 'El detalle', text: 'Lo que cambies acá vale para las libretas del ciclo.' },
  ],
  settings: [
    {
      target: 'settings.tabs',
      title: 'Secciones',
      text: 'Sistema, Institución (nombre y logo del boletín), Asistencia, Moodle y Lectores.',
    },
    { target: 'settings.content', title: 'El detalle', text: 'Cada sección se guarda por separado.' },
  ],
  profiles: [
    { target: 'profiles.list', title: 'Los perfiles', text: 'Elegí uno para ver qué puede hacer.' },
    {
      target: 'profiles.permissions',
      title: 'Permisos y alcance',
      text: 'Cada permiso vale para lo propio o para todo el centro. Lo que fija la política del sistema no se puede cambiar.',
    },
    { target: 'profiles.create', title: 'Nuevo perfil', text: 'Creá un perfil a medida con los permisos que necesite.' },
  ],
  audit: [
    { target: 'audit.filters', title: 'Filtrá', text: 'Por fecha, usuario o tipo de acción.' },
    { target: 'audit.list', title: 'Lo que pasó', text: 'Cada movimiento dice quién hizo qué y cuándo.' },
  ],
}

/** Si la pantalla se confunde con otra, el globo de «¿Buscás…?». */
export const RELATED_SPOT: Spot = {
  target: 'module-related',
  title: '¿Buscabas otra cosa?',
  text: 'Si no era esta pantalla, estos enlaces llevan a las que se le parecen.',
}

/** Al final de cada paso: dónde vive la pantalla en el menú, para volver sola. */
export function navSpot(moduleId: ModuleId, path: string): Spot {
  return { target: `nav:${moduleId}`, title: 'En el menú', text: `Para volver, está en el menú: ${path}.` }
}
