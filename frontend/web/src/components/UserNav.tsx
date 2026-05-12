'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bell, LogOut, Settings, User } from 'lucide-react'
import { api } from '@/lib/api'

type MeUser = {
  role: string
  name?: string
  email?: string
  isApproved?: boolean
  isActive?: boolean
  needsProfileCompletion?: boolean
}

function canAccessModules(me: MeUser) {
  return Boolean(me.isApproved && me.isActive && !me.needsProfileCompletion)
}

export default function UserNav() {
  const [me, setMe] = useState<MeUser | null>(null)
  const [open, setOpen] = useState(false)
  const [unreadInApp, setUnreadInApp] = useState(0)
  const pathname = usePathname()

  async function loadMe() {
    try {
      const u = await api<MeUser>('/auth/me')
      setMe(u)
    } catch {
      setMe(null)
    }
  }

  useEffect(() => {
    void loadMe()
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

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    setMe(null)
    window.location.href = '/login'
  }

  return (
    <header className="header-modern">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <a href="/" className="font-bold text-xl text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-2 shrink-0">
            <img src="/logo.svg" alt="EduTrack" className="w-8 h-8" />
            EduTrack
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {me && canAccessModules(me) && (
            <a
              href="/notifications"
              className="relative rounded-lg p-2 text-gray-600 transition-colors hover:bg-emerald-50 hover:text-emerald-600"
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
          )}
          {me ? (
            <div className="relative">
              <button 
                onClick={()=>setOpen(!open)} 
                className="flex items-center gap-3 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:border-emerald-300 hover:shadow-sm transition-all duration-200"
              >
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                  <span className="text-emerald-600 font-semibold text-sm">
                    {(me.name || me.email || '?').substring(0,1).toUpperCase()}
                  </span>
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-sm font-medium text-gray-900">{me.name || me.email}</div>
                  <div className="text-xs text-gray-500">{me.role}</div>
                </div>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden fade-in">
                  <a
                    href="/profile"
                    className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                  >
                    <User className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                    Mi perfil
                  </a>
                  {me.role === 'ADMIN' && (
                    <a
                      href="/admin/settings"
                      className="flex items-center gap-2 px-4 py-3 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                    >
                      <Settings className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                      Configuración del sistema
                    </a>
                  )}
                  <button
                    onClick={logout}
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <LogOut className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <a href="/login" className="btn-secondary text-sm">
                Iniciar Sesión
              </a>
              <a href="/register" className="btn-primary text-sm">
                Registrarse
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  )
} 
