'use client'

import { useEffect, useState } from 'react'
import { Check, Mail } from 'lucide-react'
import { api } from '@/lib/api/client'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'

/** Igual que la espera del servidor entre dos envíos (`VERIFY_RESEND_COOLDOWN_SECONDS`). */
const DEFAULT_COOLDOWN_SECONDS = 60

type Props = {
  /** Correo al que se reenvía. Sin él (y sin sesión) se le pide al usuario que lo escriba. */
  email?: string
  /** El servidor identifica a la cuenta por la sesión (cuenta logueada pero sin aprobar). */
  useSession?: boolean
  /** Si el correo acaba de salir (p. ej. al terminar el registro), arranca esperando. */
  justSent?: boolean
}

/**
 * "¿No te llegó el correo?" con reenvío y cuenta regresiva, como en cualquier alta. El servidor
 * responde siempre lo mismo (no revela si el correo está registrado), así que el mensaje de éxito
 * es condicional a propósito.
 */
export function ResendVerificationEmail({ email, useSession = false, justSent = false }: Props) {
  const askEmail = !email && !useSession
  const [typedEmail, setTypedEmail] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(justSent ? DEFAULT_COOLDOWN_SECONDS : 0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secondsLeft])

  async function resend() {
    const target = (email ?? typedEmail).trim()
    if (askEmail && !/^\S+@\S+\.\S+$/.test(target)) {
      setError('Escribí el correo con el que te registraste.')
      return
    }
    setError('')
    setSending(true)
    try {
      const res = await api<{ cooldownSeconds?: number }>('/auth/verify/request', {
        method: 'POST',
        body: JSON.stringify(useSession ? {} : { email: target }),
      })
      setSent(true)
      setSecondsLeft(res?.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS)
    } catch (e) {
      const status = (e as { status?: number }).status
      setError(
        status === 429
          ? 'Hiciste muchos pedidos seguidos. Esperá unos minutos y volvé a intentar.'
          : 'No pudimos reenviar el correo. Probá de nuevo en un momento.',
      )
    } finally {
      setSending(false)
    }
  }

  const waiting = secondsLeft > 0
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
      <p className="text-sm font-medium text-slate-800">¿No te llegó el correo?</p>
      <p className="text-sm text-slate-600">
        Puede tardar unos minutos. Revisá también las carpetas de spam y promociones.
      </p>
      {askEmail && (
        <div>
          <label htmlFor="resend-verification-email" className="mb-1 block text-xs font-medium text-slate-600">
            Correo con el que te registraste
          </label>
          <input
            id="resend-verification-email"
            type="email"
            autoComplete="email"
            className="input-field"
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.target.value)}
          />
        </div>
      )}
      <button
        type="button"
        onClick={resend}
        disabled={sending || waiting}
        className="btn-secondary inline-flex w-full items-center justify-center gap-2 text-sm disabled:opacity-60"
      >
        <PendingButtonContent
          pending={sending}
          pendingText="Enviando…"
          idle={
            <>
              <Mail className="h-4 w-4 shrink-0" aria-hidden />
              {waiting ? `Reenviar en ${secondsLeft} s` : 'Reenviar correo'}
            </>
          }
        />
      </button>
      {sent && !error && (
        <p className="flex items-start gap-2 text-sm text-emerald-800" role="status">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Si la cuenta está esperando verificación, te mandamos un enlace nuevo.
        </p>
      )}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
