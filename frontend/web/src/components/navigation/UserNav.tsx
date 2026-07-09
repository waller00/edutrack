'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  School,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  X,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { logoutUrl } from '@/lib/auth/urls'
import { clearObservabilityUser } from '@/lib/observability/user-session'
import { getRoleLabel } from '@/lib/roles/display'
import { useAuth, type AuthMe } from '@/contexts/AuthContext'

type MeUser = AuthMe

type NavItem = {
  label: string
  href: string
  permission?: string
  permissionScope?: 'own' | 'all'
}

type NavGroup = {
  title: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Inicio',
    icon: LayoutDashboard,
    items: [
      { label: 'Inicio', href: '/' },
      { label: 'Notificaciones', href: '/notifications', permission: 'notifications.read' },
    ],
  },
  {
    title: 'Equipo',
    icon: Users,
    items: [
      { label: 'Asistencias', href: '/admin/attendance', permission: 'attendance.read', permissionScope: 'all' },
      { label: 'Agenda y clases', href: '/admin/events', permission: 'events.read', permissionScope: 'all' },
      { label: 'Usuarios', href: '/admin/users', permission: 'users.read', permissionScope: 'all' },
      { label: 'Licencias', href: '/admin/licenses', permission: 'licenses.read', permissionScope: 'all' },
      { label: 'Mis eventos', href: '/me/events', permission: 'events.read', permissionScope: 'own' },
      { label: 'Mis asistencias', href: '/me/attendance', permission: 'attendance.read', permissionScope: 'own' },
      { label: 'Mis licencias', href: '/me/licenses', permission: 'licenses.read', permissionScope: 'own' },
    ],
  },
  {
    title: 'Académico',
    icon: School,
    items: [
      { label: 'Ciclos lectivos', href: '/admin/school-years', permission: 'school-years.manage' },
      { label: 'Cursos', href: '/admin/courses', permission: 'courses.manage' },
      { label: 'Notas (Moodle)', href: '/admin/grades', permission: 'courses.manage' },
      { label: 'Estudiantes', href: '/admin/students', permission: 'students.manage' },
    ],
  },
  {
    title: 'Análisis',
    icon: BarChart3,
    items: [
      { label: 'Indicadores', href: '/admin/analytics', permission: 'analytics.read' },
      { label: 'Consultas', href: '/admin/query-assistant', permission: 'query-assistant.use' },
    ],
  },
  {
    title: 'Configuración',
    icon: SlidersHorizontal,
    items: [
      { label: 'Mi perfil', href: '/profile' },
      { label: 'Configuración del sistema', href: '/admin/settings', permission: 'settings.manage' },
      { label: 'Roles / Perfiles', href: '/admin/profiles', permission: 'profiles.manage' },
      { label: 'Auditoría', href: '/admin/audit', permission: 'audit.read' },
    ],
  },
]

const PUBLIC_PATHS = ['/login', '/register', '/forgot', '/reset', '/verify', '/onboarding', '/register-step-by-step']

function canAccessModules(me: MeUser) {
  return Boolean(me.isApproved && me.isActive && !me.needsProfileCompletion)
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function itemIcon(label: string) {
  if (/curso/i.test(label)) return BookOpen
  if (/estudiante/i.test(label)) return GraduationCap
  if (/evento|clase|turno/i.test(label)) return CalendarDays
  if (/asistencia/i.test(label)) return ClipboardList
  if (/perfil|rol/i.test(label)) return ShieldCheck
  if (/consulta/i.test(label)) return MessageCircle
  if (/config/i.test(label)) return Settings
  return LayoutDashboard
}

function permissionMap(me: MeUser) {
  const map = new Map<string, 'own' | 'all'>()
  for (const id of me.permissionIds ?? []) map.set(id, 'own')
  for (const permission of me.permissions ?? []) map.set(permission.id, permission.scope === 'all' ? 'all' : 'own')
  return map
}

function canSeeItem(me: MeUser, item: NavItem) {
  if (item.permission) {
    const scope = permissionMap(me).get(item.permission)
    if (scope === undefined) return false

    if (item.permissionScope === 'all') {
      return scope === 'all'
    }

    if (item.permissionScope === 'own') {
      return scope === 'own'
    }

    return Boolean(scope)
  }

  return true
}

function hasPermission(me: MeUser, permission: string, permissionScope?: 'own' | 'all') {
  const scope = permissionMap(me).get(permission)
  return Boolean(scope && (!permissionScope || permissionScope === scope || scope === 'all'))
}

function visibleGroups(me: MeUser) {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSeeItem(me, item)),
    }))
    .filter((group) => group.items.length > 0)
}

function pathIsActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function UserNav({ children = null }: { children?: React.ReactNode }) {
  const { me } = useAuth()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [unreadInApp, setUnreadInApp] = useState(0)
  const pathname = usePathname()

  useEffect(() => {
    setUserMenuOpen(false)
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!me || !canAccessModules(me)) {
      setUnreadInApp(0)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await api<{ count: number }>('/notifications/in-app/unread-count')
        if (!cancelled) setUnreadInApp(r.count)
      } catch {
        if (!cancelled) setUnreadInApp(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, pathname])

  const groups = useMemo(() => (me ? visibleGroups(me) : []), [me])

  useEffect(() => {
    if (!me) return
    setOpenGroups((current) => {
      const next = { ...current }
      for (const group of visibleGroups(me)) {
        const active = group.items.some((item) => pathIsActive(pathname, item.href))
        if (active || next[group.title] == null) next[group.title] = active || group.title === 'Inicio'
      }
      return next
    })
  }, [me, pathname])

  async function logout() {
    clearObservabilityUser()
    globalThis.location.href = logoutUrl()
  }

  const hasDashboardShell = Boolean(me && canAccessModules(me) && !isPublicPath(pathname))

  const accountButton = me ? (
    <div className="relative">
      <button
        onClick={() => setUserMenuOpen(!userMenuOpen)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 transition-all duration-200 hover:border-emerald-300 hover:shadow-sm sm:gap-3 sm:px-3"
        aria-expanded={userMenuOpen}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
          <span className="text-sm font-semibold text-emerald-700">
            {(me.name || me.email || '?').substring(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="hidden text-left sm:block">
          <div className="max-w-[180px] truncate text-sm font-medium text-gray-900">{me.name || me.email}</div>
          <div className="text-xs text-gray-500">{me.roleLabel || getRoleLabel(me.role)}</div>
        </div>
        <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden />
      </button>
      {userMenuOpen && (
        <div className="fade-in absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <a
            href="/profile"
            className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
          >
            <User className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
            Mi perfil
          </a>
          {hasPermission(me, 'settings.manage', 'all') && (
            <a
              href="/admin/settings"
              className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
            >
              <Settings className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              Configuración del sistema
            </a>
          )}
          <button
            onClick={logout}
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  ) : null

  const sidebar = hasDashboardShell ? (
    <aside className="sidebar-modern fixed inset-y-0 left-0 z-40 flex w-[min(18rem,calc(100vw-2rem))] flex-col bg-white lg:w-72">
      <div className="flex h-16 items-center gap-3 border-b border-gray-200 px-5">
        <a href="/" className="flex min-w-0 items-center gap-2 text-xl font-bold text-emerald-600 transition-colors hover:text-emerald-700">
          <img src="/logo.svg" alt="EduTrack" className="h-8 w-8 shrink-0" />
          <span className="truncate">EduTrack</span>
        </a>
        <button
          type="button"
          className="ml-auto rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Cerrar menú"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Panel de trabajo</p>
          <p className="mt-0.5 truncate text-sm text-emerald-950">{me?.name || me?.email || 'Usuario'}</p>
        </div>

        <div className="space-y-1.5">
          {groups.map((group) => {
            const Icon = group.icon
            const expanded = openGroups[group.title] ?? false
            const groupActive = group.items.some((item) => pathIsActive(pathname, item.href))
            return (
              <div key={group.title}>
                <button
                  type="button"
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.title]: !expanded }))}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                    groupActive ? 'bg-emerald-50 text-emerald-800' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-950'
                  }`}
                  aria-expanded={expanded}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${groupActive ? 'text-emerald-700' : 'text-gray-500'}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{group.title}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {expanded && (
                  <div className="mt-1 space-y-0.5 pl-4">
                    {group.items.map((item) => {
                      const ActiveIcon = itemIcon(item.label)
                      const active = pathIsActive(pathname, item.href)
                      return (
                        <a
                          key={item.href + item.label}
                          href={item.href}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                            active
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'text-gray-600 hover:bg-emerald-50 hover:text-emerald-800'
                          }`}
                        >
                          <ActiveIcon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-gray-400'}`} aria-hidden />
                          <span className="truncate">{item.label}</span>
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>
    </aside>
  ) : null

  if (!hasDashboardShell) {
    return (
      <>
        <header className="header-modern">
          <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 py-2">
            <a href="/" className="flex min-w-0 shrink items-center gap-2 text-lg font-bold text-emerald-600 transition-colors hover:text-emerald-700 sm:text-xl">
              <img src="/logo.svg" alt="EduTrack" className="h-8 w-8" />
              <span className="truncate">EduTrack</span>
            </a>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              {me ? (
                accountButton
              ) : (
                <>
                  <a href="/login" className="btn-secondary px-3 text-sm">
                    Iniciar Sesión
                  </a>
                  <a href="/register" className="btn-primary px-3 text-sm">
                    Registrarse
                  </a>
                </>
              )}
            </div>
          </div>
        </header>
        {children}
      </>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/80">
      <div
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-slate-950/40 transition-opacity lg:hidden ${mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={() => setMobileOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setMobileOpen(false) }}
      />
      <div className={`lg:block ${mobileOpen ? 'block' : 'hidden'}`}>{sidebar}</div>
      <div className="min-h-screen lg:pl-72">
        <header className="header-modern sticky top-0 z-30 bg-white/90">
          <div className="flex h-16 items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4 lg:px-6">
            <button
              type="button"
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">EduTrack</p>
              <p className="truncate text-sm text-gray-600">Gestión diaria de la institución</p>
            </div>
            <a
              href="/notifications"
              className="relative rounded-lg p-2 text-gray-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
              title="Avisos"
              aria-label="Avisos"
            >
              <Bell className="h-5 w-5" aria-hidden />
              {unreadInApp > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white">
                  {unreadInApp > 99 ? '99+' : unreadInApp}
                </span>
              )}
            </a>
            {accountButton}
          </div>
        </header>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
