'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Bell,
  BellRing,
  BookMarked,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
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
import { SidebarSlotContext } from './sidebar-slot'

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
      { label: 'Pase de lista', href: '/me/roll-call', permission: 'student-attendance.take', permissionScope: 'own' },
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
      { label: 'Estudiantes', href: '/admin/students', permission: 'students.manage' },
      { label: 'Mensualidades', href: '/admin/tuition', permission: 'students.manage', permissionScope: 'all' },
      // Lo ven adscripción y dirección para justificar; administración también tiene `justify`.
      { label: 'Pase de lista y justificaciones', href: '/admin/student-attendance', permission: 'student-attendance.justify', permissionScope: 'all' },
    ],
  },
  {
    title: 'Libreta @',
    icon: BookMarked,
    items: [
      // El orden espeja cómo se usa: primero las libretas propias, después lo transversal.
      { label: 'Mis Libretas', href: '/libreta', permission: 'gradebook.read', permissionScope: 'own' },
      { label: 'Inasistencias de Libreta', href: '/libreta/inasistencias', permission: 'gradebook.read', permissionScope: 'own' },
      { label: 'Evaluaciones', href: '/libreta/evaluaciones', permission: 'gradebook.read', permissionScope: 'own' },
      // Una sola entrada: "por alumno" y "por libreta" abrían la misma pantalla, que ya cierra de las dos formas.
      { label: 'Cierre de períodos', href: '/libreta/cierre-alumno', permission: 'gradebook.close', permissionScope: 'own' },
      // Supervisión: adscripción, dirección e inspección.
      { label: 'Control de libretas', href: '/libreta/control', permission: 'gradebook.review', permissionScope: 'all' },
      { label: 'Visado de libretas', href: '/libreta/visado', permission: 'gradebook.read', permissionScope: 'all' },
      { label: 'Reunión de profesores', href: '/libreta/reunion', permission: 'gradebook.read', permissionScope: 'all' },
      { label: 'Inteligencia académica', href: '/libreta/indicadores', permission: 'academic-analytics.read', permissionScope: 'all' },
      { label: 'Configuración de libreta', href: '/libreta/configuracion', permission: 'academic-config.manage' },
    ],
  },
  {
    title: 'Reportes',
    icon: BellRing,
    items: [
      // Notas bajas, bajas de boletín, faltas seguidas y 18/25 faltas, con sus alertas.
      { label: 'Reportes de estudiantes', href: '/admin/reportes', permission: 'student-reports.read', permissionScope: 'all' },
    ],
  },
  {
    title: 'Análisis',
    icon: BarChart3,
    items: [
      { label: 'Indicadores', href: '/admin/analytics', permission: 'analytics.read' },
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
  if (/pase de lista/i.test(label)) return ClipboardList
  if (/reportes/i.test(label)) return BellRing
  if (/libreta|evaluacion|cierre de per|visado|reunión|reunion/i.test(label)) return BookOpen
  if (/curso/i.test(label)) return BookOpen
  if (/estudiante/i.test(label)) return GraduationCap
  if (/mensualidad/i.test(label)) return Receipt
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

const ALL_HREFS = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href))

const COLLAPSED_KEY = 'edutrack.sidebar.collapsed'
const OPEN_GROUPS_KEY = 'edutrack.sidebar.openGroups'

/**
 * Preferencias del menú lateral en este navegador. Hacen falta porque los ítems son enlaces que
 * recargan la página: sin guardarlas, cada clic volvía a abrir el menú y cerraba los grupos que
 * el usuario había desplegado. Sin storage (modo privado) el menú funciona igual, sin recordar.
 */
function readStored<T>(key: string, parse: (raw: string) => T): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw == null ? null : parse(raw)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    /* sin storage, la preferencia dura hasta recargar */
  }
}

/**
 * ¿Este ítem es el activo?
 *
 * No alcanza con que la URL empiece con el href: `/libreta` es prefijo de `/libreta/visado`, así
 * que "Mis Libretas" se marcaría como activo en todo el módulo. Gana el href **más específico**
 * que coincida.
 */
function pathIsActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  const matches = (candidate: string) =>
    pathname === candidate || pathname.startsWith(`${candidate}/`)
  if (!matches(href)) return false
  return !ALL_HREFS.some((other) => other !== href && other.length > href.length && matches(other))
}

type VisibleGroup = ReturnType<typeof visibleGroups>[number]

function NavItemLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = itemIcon(item.label)
  return (
    <a
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 hover:bg-emerald-50 hover:text-emerald-800'
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-gray-400'}`} aria-hidden />
      <span className="truncate">{item.label}</span>
    </a>
  )
}

/** Grupo del menú abierto: el título despliega o pliega sus ítems. */
function SidebarGroup({
  group,
  pathname,
  expanded,
  onToggle,
}: {
  group: VisibleGroup
  pathname: string
  expanded: boolean
  onToggle: () => void
}) {
  const Icon = group.icon
  const groupActive = group.items.some((item) => pathIsActive(pathname, item.href))
  const listId = `nav-group-${group.title.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
          groupActive ? 'bg-emerald-50 text-emerald-800' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-950'
        }`}
        aria-expanded={expanded}
        aria-controls={listId}
      >
        <Icon className={`h-5 w-5 shrink-0 ${groupActive ? 'text-emerald-700' : 'text-gray-500'}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{group.title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {expanded && (
        <div id={listId} className="mt-1 space-y-0.5 pl-4">
          {group.items.map((item) => (
            <NavItemLink key={item.href + item.label} item={item} active={pathIsActive(pathname, item.href)} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Grupo con el menú contraído: sólo el ícono. Al pasar el mouse o llegar con el teclado, sus ítems
 * se despliegan al costado; el clic vuelve a abrir el menú con ese grupo desplegado.
 *
 * El panel arranca pegado al ícono (`pl-2` y no `ml-2`): con un margen, el mouse cruzaba un hueco
 * fuera del grupo y el panel se cerraba antes de llegar.
 */
function RailGroup({ group, pathname, onOpen }: { group: VisibleGroup; pathname: string; onOpen: () => void }) {
  const Icon = group.icon
  const groupActive = group.items.some((item) => pathIsActive(pathname, item.href))
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        title={group.title}
        aria-label={`${group.title}: abrir el menú`}
        className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
          groupActive ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:bg-emerald-50 hover:text-emerald-800'
        }`}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </button>
      <div className="invisible absolute left-full top-0 z-50 pl-2 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="w-60 space-y-0.5 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          <p className="px-3 pb-1 pt-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.title}</p>
          {group.items.map((item) => (
            <NavItemLink key={item.href + item.label} item={item} active={pathIsActive(pathname, item.href)} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Contraer o expandir el menú lateral, arriba al lado del logo (como el de Claude). Sólo en
 * escritorio: en el celular el menú es un panel que se cierra con la X.
 */
function SidebarCollapseButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  const label = collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:flex ${
        collapsed ? '' : 'ml-auto'
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  )
}

/** Quién está usando el sistema, al pie del menú (como el de Claude). Contraído, sólo la inicial. */
function SidebarUser({ me, rail }: { me: MeUser; rail: boolean }) {
  const name = me.name || me.email || 'Usuario'
  const role = me.roleLabel || getRoleLabel(me.role)
  return (
    <a
      href="/profile"
      title={rail ? `${name} · ${role}` : 'Mi perfil'}
      className={`flex items-center gap-3 border-t border-gray-200 py-3 transition-colors hover:bg-gray-50 ${rail ? 'justify-center px-2' : 'px-4'}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
        {name.substring(0, 1).toUpperCase()}
      </span>
      {!rail && (
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-gray-900">{name}</span>
          <span className="block truncate text-xs text-gray-500">{role}</span>
        </span>
      )}
    </a>
  )
}

export default function UserNav({ children = null }: { children?: React.ReactNode }) {
  const { me, loading } = useAuth()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState(false)
  // Hueco arriba del menú donde la sección pone su selector de ciclo lectivo (ver `sidebar-slot`).
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [unreadInApp, setUnreadInApp] = useState(0)
  const pathname = usePathname()

  // Se leen después de montar: en el servidor no hay storage.
  useEffect(() => {
    setCollapsed(readStored(COLLAPSED_KEY, (raw) => raw === '1') ?? false)
    const stored = readStored<Record<string, boolean>>(OPEN_GROUPS_KEY, (raw) => JSON.parse(raw))
    if (stored && typeof stored === 'object') setOpenGroups((current) => ({ ...stored, ...current }))
  }, [])

  useEffect(() => {
    setUserMenuOpen(false)
    setMobileOpen(false)
  }, [pathname])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    writeStored(COLLAPSED_KEY, next ? '1' : '0')
  }

  /** Sólo se guarda lo que el usuario abre o cierra; abrir el grupo de la página actual es automático. */
  function setGroupOpen(title: string, open: boolean) {
    const next = { ...openGroups, [title]: open }
    setOpenGroups(next)
    writeStored(OPEN_GROUPS_KEY, JSON.stringify(next))
  }

  /** Con el menú contraído, el clic en un grupo abre el menú con ese grupo desplegado. */
  function openFromRail(title: string) {
    setGroupOpen(title, true)
    toggleCollapsed()
  }

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

  // Fuera de las rutas públicas, un usuario sin sesión siempre está en camino al
  // login (lo mandan `AuthGuard`, `RoleGuard` o la home). Pintar el header público
  // en esa ventana hace parpadear "Iniciar Sesión" justo antes del salto, así que
  // dejamos que se vea únicamente el placeholder del guard.
  if (!isPublicPath(pathname) && !me) {
    return <>{children}</>
  }

  // En rutas públicas sí corresponde el header, pero mientras `/auth/me` no resuelve
  // no sabemos si mostrar la cuenta o los botones de sesión: reservamos el espacio.
  let authActions: React.ReactNode
  if (loading) {
    authActions = <div className="h-10 w-32 animate-pulse rounded-lg bg-gray-100" aria-hidden />
  } else if (me) {
    authActions = accountButton
  } else {
    authActions = (
      <>
        <a href="/login" className="btn-secondary px-3 text-sm">
          Iniciar Sesión
        </a>
        <a href="/register" className="btn-primary px-3 text-sm">
          Registrarse
        </a>
      </>
    )
  }

  // En el celular el menú es un panel que se abre entero: contraído sólo aplica en escritorio.
  const rail = collapsed && !mobileOpen

  const sidebar = hasDashboardShell ? (
    <aside
      aria-label="Menú principal"
      className={`sidebar-modern fixed inset-y-0 left-0 z-40 flex w-[min(18rem,calc(100vw-2rem))] flex-col bg-white transition-[width] duration-200 ${
        rail ? 'lg:w-16' : 'lg:w-72'
      }`}
    >
      <div className={`flex h-16 items-center gap-2 border-b border-gray-200 ${rail ? 'justify-center px-2' : 'px-4'}`}>
        {/* Contraído, arriba queda sólo el botón para volver a abrirlo, como en Claude. */}
        {!rail && (
          <a
            href="/"
            title="EduTrack"
            className="flex min-w-0 items-center gap-2 text-xl font-bold text-emerald-600 transition-colors hover:text-emerald-700"
          >
            <img src="/logo.svg" alt="EduTrack" className="h-8 w-8 shrink-0" />
            <span className="truncate">EduTrack</span>
          </a>
        )}
        <SidebarCollapseButton collapsed={rail} onToggle={toggleCollapsed} />
        <button
          type="button"
          className="ml-auto rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Cerrar menú"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* El selector de ciclo lectivo de la sección llega acá por portal; sin selector no ocupa lugar. */}
      <div ref={setSlot} className={`empty:hidden ${rail ? 'px-2 pt-3' : 'px-3 pt-3'}`} />

      {/* Contraído no hay scroll: con `overflow-y-auto` el panel que se despliega al costado quedaba recortado. */}
      <nav className={`flex-1 py-4 ${rail ? 'overflow-visible px-2' : 'overflow-y-auto px-3'}`}>
        <div className={rail ? 'space-y-2' : 'space-y-1.5'}>
          {groups.map((group) => {
            if (rail) {
              return (
                <RailGroup key={group.title} group={group} pathname={pathname} onOpen={() => openFromRail(group.title)} />
              )
            }
            const groupActive = group.items.some((item) => pathIsActive(pathname, item.href))
            const expanded = openGroups[group.title] ?? (groupActive || group.title === 'Inicio')
            return (
              <SidebarGroup
                key={group.title}
                group={group}
                pathname={pathname}
                expanded={expanded}
                onToggle={() => setGroupOpen(group.title, !expanded)}
              />
            )
          })}
        </div>
      </nav>

      {me && <SidebarUser me={me} rail={rail} />}
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
              {authActions}
            </div>
          </div>
        </header>
        {children}
      </>
    )
  }

  const slotValue = { slot, rail, expand: () => rail && toggleCollapsed() }

  return (
    <SidebarSlotContext.Provider value={slotValue}>
      <div className="min-h-screen bg-slate-50/80">
        <div
          aria-hidden="true"
          className={`fixed inset-0 z-40 bg-slate-950/40 transition-opacity lg:hidden ${mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={() => setMobileOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setMobileOpen(false) }}
        />
        <div className={`lg:block ${mobileOpen ? 'block' : 'hidden'}`}>{sidebar}</div>
        <div className={`min-h-screen transition-[padding] duration-200 ${collapsed ? 'lg:pl-16' : 'lg:pl-72'}`}>
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
    </SidebarSlotContext.Provider>
  )
}
