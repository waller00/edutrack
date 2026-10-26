'use client'
import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { accountLinkGoogleUrl } from '@/lib/auth/urls'

type GoogleStatus = { linked: boolean; account: string | null }

function describe(status: GoogleStatus | null, failed: boolean): string {
  if (failed) return 'No pudimos consultar si tu cuenta tiene Google vinculado. Probá recargar la página.'
  if (!status) return 'Consultando…'
  if (status.linked) {
    return `Entrás también con «Continuar con Google»${status.account ? ` (${status.account})` : ''}.`
  }
  return 'Vinculá tu cuenta de Google para entrar también con «Continuar con Google», aunque tu Gmail no sea el correo de EduTrack. Te vamos a pedir que ingreses de nuevo.'
}

/**
 * Ingreso con Google. Quien se registró con usuario y contraseña vincula acá su cuenta de Google y
 * después entra con «Continuar con Google». Vincular pide volver a ingresar (lo exige el backend):
 * con una sesión olvidada abierta, otro podría atar su propio Google a la cuenta.
 */
export default function GoogleLinkCard() {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    api<GoogleStatus>('/auth/account/google-status')
      .then((res) => {
        if (alive) setStatus({ linked: Boolean(res?.linked), account: res?.account ?? null })
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Ingreso con Google</h3>
              {status && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.linked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {status.linked ? 'Vinculado' : 'Sin vincular'}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">{describe(status, failed)}</p>
          </div>
        </div>
        {status && !status.linked && (
          <a href={accountLinkGoogleUrl()} className="btn-secondary w-full shrink-0 sm:w-auto">
            Vincular con Google
          </a>
        )}
      </div>
    </div>
  )
}
