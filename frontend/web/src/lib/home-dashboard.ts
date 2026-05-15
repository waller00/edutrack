export type HomeMeRole = 'ADMIN' | 'TEACHER' | 'STAFF'

export type HomeMe = {
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
  | 'profiles'
  | 'settings'
  | 'chart'
  | 'calendar'
  | 'file'
  | 'dashboard'
  | 'analytics'
  | 'assistant'
  | 'default'

export function getHomeSectionIconKind(title: string): HomeSectionIconKind {
  if (title.toLowerCase().includes('estudiantes')) return 'students'
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
  if (title.toLowerCase().includes('asistente')) return 'assistant'
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
    { title: 'Gestión de asistencias', desc: 'Registro y control de asistencias del personal.', cta: 'Gestionar asistencias', href: '/admin/attendance' },
    {
      title: 'Gestión de eventos y notificaciones',
      desc: 'Crear turnos y eventos; los avisos a docentes llegan por la campana.',
      cta: 'Gestionar eventos',
      href: '/admin/events',
    },
    { title: 'Gestión de licencias', desc: 'Administra licencias médicas y laborales.', cta: 'Gestionar licencias', href: '/admin/licenses' },
    {
      title: 'Analítica institucional',
      desc: 'KPIs con tendencias semanales, rankings y exportaciones para soporte a la decisión.',
      cta: 'Abrir analítica',
      href: '/admin/analytics',
    },
    {
      title: 'Asistente de consultas',
      desc: 'Consultas en lenguaje natural: horas, incidencias, licencias, eventos, biométrico, usuarios y auditoría',
      cta: 'Abrir asistente',
      href: '/admin/query-assistant',
    },
  ],
  TEACHER: [
    { title: 'Mis asistencias', desc: 'Consulta tu historial de asistencias.', cta: 'Ver asistencias', href: '/teacher/attendance' },
    { title: 'Mis eventos', desc: 'Consulta tus eventos.', cta: 'Ver eventos', href: '/teacher/events' },
    { title: 'Mis licencias', desc: 'Consulta tus licencias registradas.', cta: 'Ver licencias', href: '/teacher/licenses' },
  ],
  STAFF: [
    { title: 'Mis asistencias', desc: 'Consulta tu historial de asistencias.', cta: 'Ver asistencias', href: '/staff/attendance' },
    { title: 'Mis eventos', desc: 'Consulta tus eventos.', cta: 'Ver eventos', href: '/staff/events' },
    { title: 'Mis licencias', desc: 'Consulta tus licencias registradas.', cta: 'Ver licencias', href: '/staff/licenses' },
  ],
}

export function getVisibleHomeSections(me: HomeMe): HomeSection[] {
  const pendingApproval = !me.isApproved
  const inactiveAccount = !me.isActive
  const needsProfile = !!me.needsProfileCompletion
  if (pendingApproval || inactiveAccount || needsProfile) return []
  return HOME_SECTIONS_BY_ROLE[me.role] || []
}
