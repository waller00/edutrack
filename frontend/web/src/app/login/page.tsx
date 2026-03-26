'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [externalError, setExternalError] = useState('')
  /** true hasta saber si ya hay sesión (evita mostrar login estando logueado) */
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) })
      window.location.href = '/'
    } catch (e:any) {
      const msg = String(e?.message||'')
      if (msg.includes('429')) setError('Tu cuenta está temporalmente bloqueada por intentos fallidos. Intenta más tarde.')
      else if (msg.includes('desactivada')) setError('Tu cuenta está dada de baja. Contacta a un administrador.')
      else setError('Credenciales inválidas')
    } finally {
      setLoading(false)
    }
  }

  function loginWithGoogle() {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/google`
  }

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
        {/* Card principal */}
        <div className="card shadow-modern-lg">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <img src="/logo.svg" alt="EduTrack" className="w-10 h-10" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Iniciar Sesión..</h1>
                    <p className="text-gray-600">Accede a tu cuenta para continuar</p>
                  </div>
          
          <form onSubmit={onSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email o Usuario
              </label>
              <input
                id="identifier"
                className="input-field"
                placeholder="Ingresa tu email o usuario"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="input-field pr-10"
                  placeholder="Ingresa tu contraseña"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {show ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            
          {(error || externalError) && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">
                  {error || (externalError === 'inactive' ? 'Tu cuenta está dada de baja. Contacta a un administrador.' : 'No se pudo iniciar sesión.')}
                </p>
              </div>
            )}
            
            <button
              className="btn-primary w-full justify-center"
              disabled={loading}
              type="submit"
            >
              {loading ? '⏳ Ingresando…' : 'Entrar'}
            </button>
          </form>
          
          <div className="flex justify-between mt-6 text-sm">
            <a href="/forgot" className="text-emerald-600 hover:text-emerald-700 font-medium">
              ¿Olvidaste tu contraseña?
            </a>
            <a href="/register" className="text-emerald-600 hover:text-emerald-700 font-medium">
              Registrarse
            </a>
          </div>
          
          <div className="flex items-center my-6">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="mx-4 text-gray-400 text-sm">o continúa con</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>
          
          <button
            onClick={loginWithGoogle}
            className="btn-secondary w-full justify-center items-center gap-3 flex"
            type="button"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span className="flex-shrink-0">Google</span>
          </button>
        </div>
        
        {/* Footer */}
        <div className="text-center mt-8 space-y-4">
          <p className="text-gray-600">
            ¿No tienes cuenta?{' '}
            <button
              onClick={() => router.push('/register')}
              className="text-green-600 hover:text-green-700 font-medium"
            >
              Regístrate aquí
            </button>
          </p>
          
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500">
              El alta quedó unificada: ya sea con email o Google, después tendrás que validar DNI y esperar aprobación administrativa.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
