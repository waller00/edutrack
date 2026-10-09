'use client'

import { Bell, BellOff, ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import {
  getCurrentDeviceWebPushState,
  getWebPushServerStatusWithRetry,
  getWebPushSupportState,
  subscribeCurrentDeviceToWebPush,
  unsubscribeCurrentDeviceFromWebPush,
  type WebPushSupportCode,
} from '@/lib/notifications/web-push-client'

function unsupportedExplanation(code: WebPushSupportCode): string {
  switch (code) {
    case 'insecure-context':
      return 'Para activar notificaciones, entrá al sitio desde su dirección segura (https://). Si no la conocés, consultá a administración.'
    case 'no-service-worker':
      return 'Este navegador tiene bloqueadas las funciones necesarias para recibir avisos. Revisá sus permisos o probá desde otro navegador.'
    case 'no-notification':
      return 'Las notificaciones no están disponibles en este navegador.'
    case 'no-push-manager':
      return 'Este navegador no permite recibir estos avisos. Probá desde otro navegador o desde la aplicación instalada en tu dispositivo.'
    default:
      return 'Las notificaciones no están disponibles en este dispositivo.'
  }
}

export default function WebPushSection() {
  const [supportCode, setSupportCode] = useState<WebPushSupportCode>('pending')
  const [configured, setConfigured] = useState(false)
  const [deviceSubscribed, setDeviceSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const refresh = useCallback(async (preserveNote = false) => {
    setLoading(true)
    setLoadError(false)
    if (!preserveNote) setNote('')
    try {
      const [serverStatus, localStatus] = await Promise.all([
        getWebPushServerStatusWithRetry(),
        getCurrentDeviceWebPushState(),
      ])
      setConfigured(serverStatus.configured)
      setDeviceSubscribed(localStatus.subscribed)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const support = getWebPushSupportState().code
    setSupportCode(support)
    if (support === 'supported') void refresh()
    else setLoading(false)
  }, [refresh])

  async function onToggle() {
    setBusy(true)
    setNote('')
    try {
      if (deviceSubscribed) {
        await unsubscribeCurrentDeviceFromWebPush()
        setDeviceSubscribed(false)
        setNote('Notificaciones desactivadas en este dispositivo.')
      } else {
        const result = await subscribeCurrentDeviceToWebPush()
        if (!result.ok) {
          setNote(result.error)
          return
        }
        setDeviceSubscribed(true)
        setNote('Notificaciones activadas en este dispositivo.')
      }
      await refresh(true)
    } catch (error: unknown) {
      setNote(error instanceof Error ? error.message : 'Error al cambiar el estado de las notificaciones.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="profile-push-title" className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div>
        <h2 id="profile-push-title" className="font-semibold text-slate-900">Notificaciones en el navegador</h2>
        <p className="mt-1 text-sm text-slate-500">Recibí avisos en este dispositivo, aunque no tengas EduTrack abierto.</p>
      </div>
      {supportCode === 'pending' ? <p role="status" className="text-sm text-slate-500">Comprobando compatibilidad…</p> : supportCode !== 'supported' ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{unsupportedExplanation(supportCode)}</p>
      ) : loading ? <p role="status" className="text-sm text-slate-500">Consultando estado…</p> : loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3">
          <p role="alert" className="text-sm text-amber-800">No se pudo consultar el estado de las notificaciones.</p>
          <button type="button" onClick={() => void refresh()} className="text-sm font-medium text-emerald-700 hover:underline">Reintentar</button>
        </div>
      ) : !configured ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Las notificaciones todavía no están habilitadas por la institución. Consultá a administración.</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {deviceSubscribed ? <Bell className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden /> : <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />}
            <div>
              <p className="text-sm font-medium text-slate-800">{deviceSubscribed ? 'Activadas en este dispositivo' : 'Desactivadas en este dispositivo'}</p>
              <p className="mt-1 text-xs text-slate-500">Esta preferencia se aplica a este navegador.</p>
            </div>
          </div>
          <button type="button" onClick={() => void onToggle()} disabled={busy}
            className={`${deviceSubscribed ? 'btn-secondary' : 'btn-primary'} inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto`}>
            <PendingButtonContent pending={busy} pendingText={deviceSubscribed ? 'Desactivando…' : 'Activando…'} idle={deviceSubscribed ? 'Desactivar notificaciones' : 'Activar notificaciones'} />
          </button>
        </div>
      )}
      {note && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-800">{note}</p>}
      <details className="group border-t border-slate-100 pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm text-slate-600 [&::-webkit-details-marker]:hidden">
          Cómo funcionan<ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden />
        </summary>
        <p className="mt-3 text-sm text-slate-500">El navegador te pedirá permiso al activarlas. Si usás varios dispositivos, activalas en cada uno donde quieras recibir avisos.</p>
      </details>
    </section>
  )
}
