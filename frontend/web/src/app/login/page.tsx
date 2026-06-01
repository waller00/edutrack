'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { loginUrl } from '@/lib/auth/urls'

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export default function LoginPage() {
  const router = useRouter()
  const [externalError, setExternalError] = useState('')
  const [loggedOut, setLoggedOut] = useState(false)
  const [sessionPending, setSessionPending] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error') || ''
    const loggedOutParam = params.get('loggedOut') === '1'
    const returnTo = safeReturnTo(params.get('returnTo'))

    let alive = true
    setExternalError(error)
    setLoggedOut(loggedOutParam)

    api('/auth/me')
      .then(() => {
        if (alive) router.replace(returnTo)
      })
      .catch((err: unknown) => {
        if (!alive) return
        const status = typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: number }).status)
          : undefined
        if (status === 403) {
          setExternalError('account')
          setSessionPending(false)
          return
        }
        if (error || loggedOutParam) {
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
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {loggedOut ? 'Sesión cerrada' : externalError === 'account' ? 'Cuenta no habilitada' : 'No se pudo iniciar sesión'}
            </h1>
            <p className="text-gray-600">
              {loggedOut
                ? 'Podés volver a ingresar cuando lo necesites.'
                : externalError === 'account'
                  ? 'Tu cuenta está pendiente de aprobación o fue inhabilitada. Contactá a un administrador.'
                  : 'El proveedor de identidad no completó el ingreso.'}
            </p>
          </div>
          {loggedOut && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
              <p className="text-sm text-emerald-800">Tu sesión local y la sesión de Keycloak fueron cerradas.</p>
            </div>
          )}
          {externalError && externalError !== 'account' && (
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
            Ingresar
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
