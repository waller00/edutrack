'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api/client'
import { loginUrl } from '@/lib/auth/urls'

export default function LoginPage() {
  const router = useRouter()
  const [externalError, setExternalError] = useState('')
  const [sessionPending, setSessionPending] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setExternalError(params.get('error') || '')
  }, [])

  useEffect(() => {
    let alive = true
    api('/auth/me')
      .then(() => {
        if (alive) router.replace('/')
      })
      .catch(() => {
        if (alive) setSessionPending(false)
      })
    return () => {
      alive = false
    }
  }, [router])

  if (sessionPending) {
    return (
      <main className="min-h-screen gradient-light flex items-center justify-center p-4">
        <p className="text-gray-600">Cargando…</p>
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
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Iniciar Sesión</h1>
            <p className="text-gray-600">Accede con tu cuenta institucional (Keycloak)</p>
          </div>
          {externalError && (
            <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm">No se pudo iniciar sesión. Intenta nuevamente.</p>
            </div>
          )}
          <button
            className="btn-primary w-full justify-center"
            type="button"
            onClick={() => { window.location.href = loginUrl('/') }}
          >
            Continuar
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
