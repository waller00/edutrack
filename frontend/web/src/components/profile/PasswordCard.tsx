'use client'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { ExternalLink, KeyRound } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { api } from '@/lib/api/client'
import { accountPasswordUrl, accountReauthUrl } from '@/lib/auth/urls'
import {
  PASSWORD_MAX_LENGTH,
  getPasswordStrength,
  getStrengthBarClass,
  validateNewPassword,
} from '@/lib/auth/password-strength'

type Props = {
  username: string
  /** Vuelve de reautenticarse para crear la contraseña: abre el formulario. */
  openCreate?: boolean
  onCreated?: (message: string) => void
}

type ApiError = { message?: string; data?: { code?: string; message?: string } }

/**
 * Contraseña de la cuenta. "Cambiar contraseña" de Keycloak pide la actual, y quien se registró con
 * Google no tiene: a esa cuenta se le ofrece crearla acá.
 */
export default function PasswordCard({ username, openCreate = false, onCreated }: Readonly<Props>) {
  // null mientras se consulta; si la consulta falla queda "cambiar", como antes.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  const [formOpen, setFormOpen] = useState(openCreate)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api<{ hasPassword?: boolean }>('/auth/account/password-status')
      .then((res) => { if (alive) setHasPassword(res?.hasPassword !== false) })
      .catch(() => { if (alive) setHasPassword(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (openCreate) setFormOpen(true)
  }, [openCreate])

  async function createPassword(event: FormEvent) {
    event.preventDefault()
    setError('')
    const invalid = validateNewPassword(password)
    if (invalid) { setError(invalid); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true)
    try {
      await api('/auth/account/password', { method: 'POST', body: JSON.stringify({ password }) })
      setHasPassword(true)
      setFormOpen(false)
      setPassword('')
      setConfirm('')
      onCreated?.('Contraseña creada: ya podés ingresar también con tu usuario y esta contraseña.')
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.data?.code === 'REAUTH_REQUIRED') {
        globalThis.location.href = accountReauthUrl()
        return
      }
      setError(apiError.data?.message || apiError.message || 'No se pudo crear la contraseña.')
    } finally {
      setBusy(false)
    }
  }

  const withoutPassword = hasPassword === false
  const strength = getPasswordStrength(password)

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Contraseña</h3>
            <p className="mt-1 text-xs text-slate-500">
              {withoutPassword
                ? `Hoy ingresás con Google. Creá una contraseña para entrar también con tu usuario${username ? ` (${username})` : ''}.`
                : 'Elegí una contraseña nueva para tu cuenta.'}
            </p>
          </div>
        </div>
        {hasPassword === true && (
          <a href={accountPasswordUrl()} className="btn-secondary w-full shrink-0 sm:w-auto">
            Cambiar contraseña<ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          </a>
        )}
        {withoutPassword && !formOpen && (
          <button type="button" onClick={() => setFormOpen(true)} className="btn-secondary w-full shrink-0 sm:w-auto">
            Crear contraseña
          </button>
        )}
      </div>
      {withoutPassword && formOpen && (
        <form onSubmit={createPassword} className="space-y-3 border-t border-slate-100 pt-4" noValidate>
          <div>
            <label htmlFor="profile-new-password" className="mb-1 block text-sm font-medium text-slate-700">Contraseña nueva</label>
            <input
              id="profile-new-password"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className="input-field"
            />
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100" aria-hidden>
              <div className={`h-1.5 rounded-full ${getStrengthBarClass(strength)}`} style={{ width: `${strength}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Al menos 8 caracteres, con una mayúscula, una minúscula y un número.</p>
          </div>
          <div>
            <label htmlFor="profile-confirm-password" className="mb-1 block text-sm font-medium text-slate-700">Repetí la contraseña</label>
            <input
              id="profile-confirm-password"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              className="input-field"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} />
            Mostrar contraseñas
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { setFormOpen(false); setError('') }} disabled={busy} className="btn-secondary w-full sm:w-auto">
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60 sm:w-auto">
              <PendingButtonContent pending={busy} pendingText="Creando…" idle="Crear contraseña" />
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
