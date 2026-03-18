'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

const itemsByRole: Record<string, { href: string; label: string }[]> = {
  ADMIN: [
    { href: '/admin/users', label: 'Usuarios' },
    { href: '/admin/attendance', label: 'Asistencias' },
    { href: '/admin/events', label: 'Eventos' },
    { href: '/admin/licenses', label: 'Licencias' },
  ],
  TEACHER: [
    { href: '/teacher/attendance', label: 'Mis asistencias' },
    { href: '/teacher/events', label: 'Mis eventos' },
    { href: '/teacher/reports', label: 'Reportes' },
  ],
  STAFF: [
    { href: '/staff/attendance', label: 'Mis asistencias' },
    { href: '/staff/events', label: 'Mis eventos' },
    { href: '/staff/reports', label: 'Reportes' },
  ],
}

export default function UserNav() {
  const [me, setMe] = useState<any>(null)
  const [open, setOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState('')

  async function loadMe() {
    try {
      const u = await api('/auth/me')
      setMe(u)
    } catch {
      setMe(null)
    }
  }

  useEffect(() => { 
    loadMe()
    setCurrentPath(window.location.pathname)
  }, [])

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    setMe(null)
    window.location.href = '/login'
  }

  const roleItems = me ? (itemsByRole[me.role] || []) : []
  const showBackButton = currentPath !== '/' && currentPath !== '/login' && currentPath !== '/register'

  return (
    <header className="header-modern">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {showBackButton && (
            <button 
              onClick={() => window.history.back()}
              className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all duration-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-sm font-medium">Volver</span>
            </button>
          )}
          <a href="/" className="font-bold text-xl text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-2">
            <img src="/logo.svg" alt="EduTrack" className="w-8 h-8" />
            EduTrack
          </a>
        </div>
        {me && (
          <nav className="hidden md:flex gap-8 text-sm font-medium">
            {roleItems.map(it => (
              <a
                key={it.label}
                href={it.href}
                className="text-gray-700 hover:text-emerald-600 transition-colors duration-200 relative group"
              >
                {it.label}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-emerald-600 transition-all duration-200 group-hover:w-full"></span>
              </a>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-4">
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
                  <a href="/profile" className="block px-4 py-3 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
                    👤 Mi perfil
                  </a>
                  <button 
                    onClick={logout} 
                    className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    🚪 Cerrar sesión
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
