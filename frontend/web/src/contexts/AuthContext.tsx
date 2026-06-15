'use client'

import { api } from '@/lib/api/client'
import { clearObservabilityUser, identifyObservabilityUser } from '@/lib/observability/user-session'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/** Usuario autenticado tal como lo devuelve `GET /auth/me`. */
export type AuthMe = {
  id?: string
  role: string
  /** Label amistoso del rol (cubre roles personalizados); puede faltar en sesiones viejas. */
  roleLabel?: string | null
  name?: string
  email?: string
  username?: string
  firstName?: string
  lastName?: string
  nationalId?: string
  phone?: string
  birthdate?: string
  emailVerifiedAt?: string | null
  isApproved?: boolean
  isActive?: boolean
  needsProfileCompletion?: boolean
  permissionIds?: string[]
  permissions?: Array<{ id: string; scope?: 'own' | 'all' }>
}

type AuthContextValue = {
  /** `null` mientras carga o cuando no hay sesión (401). */
  me: AuthMe | null
  loading: boolean
  /** La última carga falló (incluye 401: no autenticado). */
  error: boolean
  /** Re-consulta `/auth/me` (p. ej. tras editar el perfil). */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Fuente única del usuario autenticado en el cliente: hace **una sola** llamada a
 * `/auth/me` y la comparte con todos los consumidores (nav, guards, páginas), evitando
 * llamadas duplicadas y el parpadeo al navegar. No redirige: los redirects viven en `RoleGuard`.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<AuthMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const u = await api<AuthMe>('/auth/me')
      setMe(u)
      setError(false)
      if (u?.id) identifyObservabilityUser(u.id)
      else clearObservabilityUser()
    } catch {
      setMe(null)
      setError(true)
      clearObservabilityUser()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AuthContextValue>(() => ({ me, loading, error, refresh }), [me, loading, error, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
