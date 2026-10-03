'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import AuthLoadingScreen from '@/components/auth/AuthLoadingScreen'
import { resolveAuthRedirect } from '@/components/auth/auth-redirect'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Guard de autenticación para montar en un layout: mientras no haya sesión válida
 * no renderiza `children`, así el subárbol nunca se monta y sus efectos (fetches a
 * la API) no llegan a dispararse. Los permisos por módulo siguen en `RoleGuard`,
 * dentro de cada página.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth()
  const pathname = usePathname()
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (loading) return
    const redirect = resolveAuthRedirect(me, pathname)
    if (redirect) {
      globalThis.location.href = redirect
      return
    }
    setOk(true)
  }, [me, loading, pathname])

  if (!ok) return <AuthLoadingScreen />
  return <>{children}</>
}
