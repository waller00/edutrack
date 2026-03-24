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
  return 'Bienvenido al sistema de gestión de asistencias. Accede a las herramientas disponibles para tu rol.'
}

export type HomeSectionIconKind =
  | 'users'
  | 'chart'
  | 'calendar'
  | 'file'
  | 'dashboard'
  | 'default'

export function getHomeSectionIconKind(title: string): HomeSectionIconKind {
  if (title.includes('usuarios')) return 'users'
  if (title.includes('asistencias')) return 'chart'
  if (title.includes('eventos')) return 'calendar'
  if (title.includes('licencias')) return 'file'
  if (title.includes('Panel')) return 'dashboard'
  return 'default'
}

export const HOME_SECTIONS_BY_ROLE: Record<HomeMeRole, HomeSection[]> = {
  ADMIN: [
    { title: 'Gestión de usuarios', desc: 'Altas, roles y permisos.', cta: 'Administrar usuarios', href: '/admin/users' },
    { title: 'Gestión de asistencias', desc: 'Registro y control de asistencias del personal.', cta: 'Gestionar asistencias', href: '/admin/attendance' },
    { title: 'Gestión de eventos', desc: 'Crear y administrar turnos y eventos.', cta: 'Gestionar eventos', href: '/admin/events' },
    { title: 'Gestión de licencias', desc: 'Administra licencias médicas y laborales.', cta: 'Gestionar licencias', href: '/admin/licenses' },
  ],
  TEACHER: [
    { title: 'Mis asistencias', desc: 'Consulta tu historial de asistencias.', cta: 'Ver asistencias', href: '/teacher/attendance' },
    { title: 'Mis eventos', desc: 'Consulta tus eventos.', cta: 'Ver eventos', href: '/teacher/events' },
  ],
  STAFF: [
    { title: 'Mis asistencias', desc: 'Consulta tu historial de asistencias.', cta: 'Ver asistencias', href: '/staff/attendance' },
    { title: 'Mis eventos', desc: 'Consulta tus eventos.', cta: 'Ver eventos', href: '/staff/events' },
  ],
}

export function getVisibleHomeSections(me: HomeMe): HomeSection[] {
  const pendingApproval = !me.isApproved
  const inactiveAccount = !me.isActive
  const needsProfile = !!me.needsProfileCompletion
  if (pendingApproval || inactiveAccount || needsProfile) return []
  return HOME_SECTIONS_BY_ROLE[me.role] || []
}
