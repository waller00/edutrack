export type HomeMeRole = 'ADMIN' | 'TEACHER' | 'STAFF' | 'STUDENT'

export type HomeMe = {
  id?: string
  name?: string
  email: string
  role: HomeMeRole
  emailVerifiedAt?: string | null
  needsProfileCompletion?: boolean
  isApproved: boolean
  isActive: boolean
}

export type HomeSection = { title: string; desc: string; cta: string; href: string }

export function getWelcomeMessage(inactiveAccount: boolean, pendingApproval: boolean): string {
  if (inactiveAccount) return 'Tu cuenta está desactivada y no puede usar módulos operativos.'
  if (pendingApproval)
    return 'Tu información fue recibida. Cuando un administrador te apruebe, vas a ver las herramientas correspondientes a tu rol.'
  return 'Bienvenido al sistema de Gestion Administrativa Integral para instituciones educativas.'
}

export type HomeSectionIconKind =
  | 'users'
  | 'students'
  | 'courses'
  | 'profiles'
  | 'settings'
  | 'chart'
  | 'calendar'
  | 'file'
  | 'dashboard'
  | 'analytics'
  | 'default'

export function getHomeSectionIconKind(title: string): HomeSectionIconKind {
  if (title.toLowerCase().includes('estudiantes')) return 'students'
  if (title.toLowerCase().includes('cursos') && title.toLowerCase().includes('asignaturas')) return 'courses'
  if (title.includes('usuarios')) return 'users'
  if (title.includes('perfiles')) return 'profiles'
  if (title.includes('Configuración')) return 'settings'
  if (title.includes('asistencias')) return 'chart'
  if (title.includes('eventos')) return 'calendar'
  if (title.includes('licencias')) return 'file'
  {
    const t = title.toLowerCase()
    if (t.includes('analít') || t.includes('analit') || t.includes('analytics')) return 'analytics'
  }
  if (title.includes('Panel')) return 'dashboard'
  return 'default'
}

export const HOME_SECTIONS_BY_ROLE: Record<HomeMeRole, HomeSection[]> = {
  ADMIN: [
    { title: 'Gestión de usuarios', desc: 'Gestiona los usuarios del sistema.', cta: 'Administrar usuarios', href: '/admin/users' },
    {
      title: 'Estudiantes (matrícula y cuotas)',
      desc: 'Registro administrativo sin login: curso, contacto, cuotas por año y abandono.',
      cta: 'Gestionar estudiantes',
      href: '/admin/students',
    },
    {
      title: 'Cursos y asignaturas',
      desc: 'Catálogo por ciclo lectivo: asignaturas por curso (orientaciones distintas = cursos distintos).',
      cta: 'Gestionar cursos',
      href: '/admin/courses',
    },
    { title: 'Asistencias del día', desc: 'Control operativo de presencias, ausencias, tardanzas y salidas.', cta: 'Revisar asistencias', href: '/admin/attendance' },
    {
      title: 'Agenda y clases',
      desc: 'Crear clases, jornadas, reuniones y suplencias; los avisos llegan por la campana.',
      cta: 'Abrir agenda',
      href: '/admin/events',
    },
    { title: 'Licencias', desc: 'Administrá licencias médicas y laborales.', cta: 'Revisar licencias', href: '/admin/licenses' },
    {
      title: 'Analítica institucional',
      desc: 'KPIs con tendencias semanales, rankings y exportaciones para soporte a la decisión.',
      cta: 'Abrir analítica',
      href: '/admin/analytics',
    },
  ],
  TEACHER: [
    { title: 'Mis asistencias', desc: 'Consulta tu historial de asistencias.', cta: 'Ver asistencias', href: '/teacher/attendance' },
    { title: 'Mi agenda', desc: 'Consultá tus clases, turnos y reuniones asignadas.', cta: 'Ver agenda', href: '/teacher/events' },
    { title: 'Mis licencias', desc: 'Consulta tus licencias registradas.', cta: 'Ver licencias', href: '/teacher/licenses' },
  ],
  STAFF: [
    { title: 'Mis asistencias', desc: 'Consulta tu historial de asistencias.', cta: 'Ver asistencias', href: '/staff/attendance' },
    { title: 'Mi agenda', desc: 'Consultá tus clases, turnos y reuniones asignadas.', cta: 'Ver agenda', href: '/staff/events' },
    { title: 'Mis licencias', desc: 'Consulta tus licencias registradas.', cta: 'Ver licencias', href: '/staff/licenses' },
  ],
  STUDENT: [],
}

export function getVisibleHomeSections(me: HomeMe): HomeSection[] {
  const pendingApproval = !me.isApproved
  const inactiveAccount = !me.isActive
  const needsProfile = !!me.needsProfileCompletion
  if (pendingApproval || inactiveAccount || needsProfile) return []
  return HOME_SECTIONS_BY_ROLE[me.role] || []
}
