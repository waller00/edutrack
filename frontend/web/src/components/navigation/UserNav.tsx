'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  ChevronDown,
  CircleHelp,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  User,
  X,
} from 'lucide-react'
import { logoutUrl } from '@/lib/auth/urls'
import { clearObservabilityUser } from '@/lib/observability/user-session'
import { getRoleLabel } from '@/lib/roles/display'
import { hasPermission } from '@/lib/auth/permissions'
import { APP_MODULES, visibleNavGroups, type AppModule, type VisibleNavGroup } from '@/lib/navigation/modules'
import { useAuth, type AuthMe } from '@/contexts/AuthContext'
import RollCallReminderBar from '@/components/rollcall/RollCallReminderBar'
import NotificationBell from '@/components/notifications/NotificationBell'
import NotificationToast from '@/components/notifications/NotificationToast'
import { NotificationsProvider } from '@/components/notifications/NotificationsProvider'
import { SidebarSlotContext } from './sidebar-slot'

type MeUser = AuthMe

/*
 * Los grupos, los nombres, los íconos y los permisos del menú salen del catálogo de módulos
 * (`lib/navigation/modules.ts`), el mismo que usan Inicio, los encabezados y la Guía. Los grupos
 * van por destinatario —Mi trabajo, Personal, Estudiantes…— para que la asistencia del personal y
 * la de los estudiantes no queden mezcladas. Los avisos no van en el menú: están en la campana.
 */

const PUBLIC_PATHS = ['/login', '/register', '/forgot', '/reset', '/verify', '/onboarding', '/register-step-by-step']

function canAccessModules(me: MeUser) {
  return Boolean(me.isApproved && me.isActive && !me.needsProfileCompletion)
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function visibleGroups(me: MeUser) {
  return visibleNavGroups(me)
}


const ALL_HREFS = APP_MODULES.map((entry) => entry.href)

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
 * que "Mis libretas" se marcaría como activo en todo el módulo. Gana el href **más específico**
 * que coincida.
 */
function pathIsActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  const matches = (candidate: string) =>
    pathname === candidate || pathname.startsWith(`${candidate}/`)
  if (!matches(href)) return false
  return !ALL_HREFS.some((other) => other !== href && other.length > href.length && matches(other))
}

type VisibleGroup = VisibleNavGroup

function NavItemLink({ item, active }: { item: AppModule; active: boolean }) {
  const Icon = item.icon
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
  const groupActive = group.modules.some((item) => pathIsActive(pathname, item.href))
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
          {group.modules.map((item) => (
            <NavItemLink key={item.id} item={item} active={pathIsActive(pathname, item.href)} />
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
  const groupActive = group.modules.some((item) => pathIsActive(pathname, item.href))
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
          {group.modules.map((item) => (
            <NavItemLink key={item.id} item={item} active={pathIsActive(pathname, item.href)} />
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

  const groups = useMemo(() => (me ? visibleGroups(me) : []), [me])

  useEffect(() => {
    if (!me) return
    setOpenGroups((current) => {
      const next = { ...current }
      for (const group of visibleGroups(me)) {
        const active = group.modules.some((item) => pathIsActive(pathname, item.href))
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
          <a
            href="/guia"
            className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
          >
            <CircleHelp className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
            Guía de EduTrack
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
            const groupActive = group.modules.some((item) => pathIsActive(pathname, item.href))
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
    <NotificationsProvider>
      <SidebarSlotContext.Provider value={slotValue}>
        <div className="min-h-screen bg-slate-50/80">
          {/* Primer elemento del recorrido con teclado: sin él, cada página obligaba a pasar por
              todos los grupos del menú lateral antes de llegar al contenido. */}
          <a
            href="#contenido-principal"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-emerald-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
          >
            Saltar al contenido
          </a>
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
                <NotificationBell />
                {accountButton}
              </div>
              {/* Durante la clase, debajo del encabezado y en cualquier pantalla: "pasá la lista". */}
              {me && hasPermission(me, 'student-attendance.take') && <RollCallReminderBar />}
            </header>
            <div id="contenido-principal" tabIndex={-1} className="min-w-0 focus:outline-none">
              {children}
            </div>
          </div>
        </div>
        <NotificationToast />
      </SidebarSlotContext.Provider>
    </NotificationsProvider>
  )
}
