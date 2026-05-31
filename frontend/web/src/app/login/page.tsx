'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api/client'
import { loginUrl } from '@/lib/auth/urls'

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export default function LoginPage() {
  const router = useRouter()
  const [externalError, setExternalError] = useState('')
  const [sessionPending, setSessionPending] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error') || ''
    const returnTo = safeReturnTo(params.get('returnTo'))

    let alive = true
    setExternalError(error)

    api('/auth/me')
      .then(() => {
        if (alive) router.replace(returnTo)
      })
      .catch(() => {
        if (!alive) return
        if (error) {
          setSessionPending(false)
          return
        }
        window.location.href = loginUrl(returnTo)
      })

    return () => {
      alive = false
    }
  }, [router])

  if (sessionPending) {
    return (
      <main className="min-h-screen gradient-light flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-sm font-medium text-gray-600">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-600" aria-hidden />
          Conectando con EduTrack
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen gradient-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card shadow-modern-lg">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <img src="/logo.svg" alt="EduTrack" className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">No se pudo iniciar sesion</h1>
            <p className="text-gray-600">El proveedor de identidad no completo el ingreso.</p>
          </div>
          {externalError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
              <p className="text-sm text-red-700">Intentá nuevamente. Si el problema continúa, revisá la configuración de Keycloak.</p>
            </div>
          )}
          <button
            className="btn-primary w-full justify-center"
            type="button"
            onClick={() => { window.location.href = loginUrl('/') }}
          >
            Reintentar ingreso
          </button>
          <div className="mt-6 text-center">
            <a href="/register" className="text-emerald-600 hover:text-emerald-700 font-medium text-sm">
              Registrarse
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
