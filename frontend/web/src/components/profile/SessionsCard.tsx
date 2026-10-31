'use client'
import { useCallback, useEffect, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { api } from '@/lib/api/client'
import { accountReauthUrl } from '@/lib/auth/urls'
import { describeSessionDevice } from '@/lib/auth/session-device'
import { formatDateTimeInUruguay } from '@/lib/forms/datetime-uy'

type SessionRow = { current: boolean; createdAt: string; userAgent: string | null; ip: string | null }

type Props = {
  /** Vuelve de reingresar para cerrar las otras sesiones: muestra la confirmación. */
  confirmRequested?: boolean
  onClosed?: (message: string) => void
}

type ApiError = { message?: string; data?: { code?: string; message?: string } }

function closedMessage(closed: number): string {
  if (closed === 0) return 'No quedaban otras sesiones abiertas.'
  const sessions = closed === 1 ? '1 sesión' : `${closed} sesiones`
  return `Listo: se cerraron ${sessions} en otros dispositivos. Para volver a entrar ahí van a tener que ingresar de nuevo.`
}

/**
 * Sesiones abiertas de la cuenta (OWASP ASVS 3.3.4). Un mismo usuario puede estar abierto en
 * varios dispositivos a la vez; acá ve dónde y puede cerrar los demás. Cerrar pide un ingreso
 * reciente (lo exige el backend): con una sesión robada no se puede echar al dueño.
 */
export default function SessionsCard({ confirmRequested = false, onClosed }: Readonly<Props>) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(confirmRequested)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await api<{ sessions?: SessionRow[] }>('/auth/account/sessions')
      setSessions(res?.sessions ?? [])
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (confirmRequested) setConfirming(true)
  }, [confirmRequested])

  async function closeOthers() {
    setError('')
    setBusy(true)
    try {
      const res = await api<{ closed?: number }>('/auth/account/sessions/close-others', { method: 'POST' })
      setConfirming(false)
      onClosed?.(closedMessage(res?.closed ?? 0))
      await load()
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.data?.code === 'REAUTH_REQUIRED') {
        globalThis.location.href = accountReauthUrl('sessions')
        return
      }
      setError(apiError.data?.message || apiError.message || 'No se pudieron cerrar las otras sesiones.')
    } finally {
      setBusy(false)
    }
  }

  const others = sessions?.filter((session) => !session.current).length ?? 0

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Sesiones abiertas</h3>
          <p className="mt-1 text-xs text-slate-500">
            Podés tener EduTrack abierto en varios dispositivos a la vez. Si ves uno que no reconocés, cerrá las otras sesiones y cambiá tu contraseña.
          </p>
        </div>
      </div>

      {failed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3">
          <p role="alert" className="text-sm text-amber-800">No se pudieron consultar tus sesiones.</p>
          <button type="button" onClick={() => void load()} className="text-sm font-medium text-emerald-700 hover:underline">Reintentar</button>
        </div>
      )}
      {!failed && !sessions && <p role="status" className="text-sm text-slate-500">Consultando sesiones…</p>}

      {sessions && sessions.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
          {sessions.map((session, index) => (
            <li key={`${session.createdAt}-${index}`} className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium text-slate-800">
                {describeSessionDevice(session.userAgent)}
                {session.current && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Esta sesión</span>}
              </span>
              <span className="text-xs text-slate-500">
                Desde el {formatDateTimeInUruguay(session.createdAt)}
                {session.ip ? ` · IP ${session.ip}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {sessions && others === 0 && <p className="text-xs text-slate-500">No tenés sesiones abiertas en otros dispositivos.</p>}

      {sessions && others > 0 && !confirming && (
        <button type="button" onClick={() => setConfirming(true)} className="btn-secondary w-full sm:w-auto">
          Cerrar las otras sesiones ({others})
        </button>
      )}

      {sessions && others > 0 && confirming && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">
            ¿Cerrar {others === 1 ? 'la otra sesión' : `las otras ${others} sesiones`}? Esta queda abierta; en los otros dispositivos van a tener que ingresar de nuevo.
          </p>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { setConfirming(false); setError('') }} disabled={busy} className="btn-secondary w-full sm:w-auto">
              Cancelar
            </button>
            <button type="button" onClick={() => void closeOthers()} disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60 sm:w-auto">
              <PendingButtonContent pending={busy} pendingText="Cerrando…" idle="Cerrar sesiones" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
