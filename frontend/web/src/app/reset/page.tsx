'use client'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { api } from '@/lib/api/client'
import { loginUrl } from '@/lib/auth/urls'
import {
  PASSWORD_MAX_LENGTH,
  getPasswordStrength,
  getStrengthBarClass,
  validateNewPassword,
} from '@/lib/auth/password-strength'

type ApiError = { message?: string; data?: { code?: string; message?: string } }

/**
 * Elegir la contraseña nueva con el enlace de "Olvidé mi contraseña". El correo lo manda EduTrack
 * (Brevo); antes lo mandaba Keycloak y no llegaba.
 */
export default function ResetPage() {
  const [token, setToken] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invalidLink, setInvalidLink] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const value = new URLSearchParams(globalThis.location.search).get('token') || ''
    setToken(value)
    if (!value) setInvalidLink(true)
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const invalid = validateNewPassword(password)
    if (invalid) { setError(invalid); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true)
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) })
      setDone(true)
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.data?.code === 'RESET_TOKEN_INVALID') {
        setInvalidLink(true)
        return
      }
      setError(apiError.data?.message || apiError.message || 'No se pudo cambiar la contraseña.')
    } finally {
      setBusy(false)
    }
  }

  const strength = getPasswordStrength(password)

  return (
    <main className="min-h-screen gradient-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card shadow-modern-lg">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100">
              <img src="/logo.svg" alt="EduTrack" className="h-10 w-10" />
            </div>
            <h1 className="mb-2 text-2xl font-bold text-gray-900">
              {done ? 'Contraseña actualizada' : 'Elegí tu contraseña nueva'}
            </h1>
            {!done && !invalidLink && (
              <p className="text-gray-600">Al cambiarla cerramos las sesiones que tengas abiertas.</p>
            )}
          </div>

          {done && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                <p className="text-sm text-emerald-800">Ya podés ingresar con tu usuario o correo y la contraseña nueva.</p>
              </div>
              <a href={loginUrl('/')} className="btn-primary w-full justify-center">Ingresar</a>
            </div>
          )}

          {!done && invalidLink && (
            <div className="space-y-4">
              <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                El enlace venció o ya se usó. Pedí uno nuevo: vale por 60 minutos y una sola vez.
              </p>
              <a href="/forgot" className="btn-primary w-full justify-center">Pedir otro enlace</a>
            </div>
          )}

          {!done && !invalidLink && token !== null && (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="reset-password" className="mb-1 block text-sm font-medium text-gray-700">Contraseña nueva</label>
                <input
                  id="reset-password"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className="input-field"
                />
                <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100" aria-hidden>
                  <div className={`h-1.5 rounded-full ${getStrengthBarClass(strength)}`} style={{ width: `${strength}%` }} />
                </div>
                <p className="mt-1 text-xs text-gray-500">Al menos 8 caracteres, con una mayúscula, una minúscula y un número.</p>
              </div>
              <div>
                <label htmlFor="reset-confirm" className="mb-1 block text-sm font-medium text-gray-700">Repetí la contraseña</label>
                <input
                  id="reset-confirm"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  maxLength={PASSWORD_MAX_LENGTH}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                  className="input-field"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} />
                Mostrar contraseñas
              </label>
              {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
                <PendingButtonContent pending={busy} pendingText="Guardando…" idle="Guardar contraseña" />
              </button>
            </form>
          )}

          {!done && (
            <div className="mt-6 text-center">
              <a href="/login" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
                Volver al inicio de sesión
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
