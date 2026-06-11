'use client'

import { Bell, BellOff } from 'lucide-react'
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
      return 'Las notificaciones push requieren HTTPS (contexto seguro). Si entrás por http:// a la IP del servidor, el navegador no habilita push ni service worker: usá el dominio con SSL (por ejemplo detrás de Cloudflare) o https:// en el puerto público. En tu PC, http://localhost sí cuenta como seguro.'
    case 'no-service-worker':
      return 'Este navegador no ofrece service workers, o están bloqueados (extensiones, políticas del dispositivo). Probá Chrome o Edge actualizado, o otra ventana sin modo restringido.'
    case 'no-notification':
      return 'Este entorno no expone la API de notificaciones del sistema.'
    case 'no-push-manager':
      return 'Este navegador no soporta la API Push web (o está en modo privado / WebView donde no está disponible). En iPhone/iPad hace falta iOS 16.4+ y Safari; en desktop usá Chrome, Edge o Firefox recientes.'
    default:
      return 'Tu navegador no admite notificaciones push web en estas condiciones.'
  }
}

export default function WebPushSection() {
  const [supportCode, setSupportCode] = useState<WebPushSupportCode>('pending')
  const [configured, setConfigured] = useState(false)
  const [deviceSubscribed, setDeviceSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setNote('')
    try {
      const [serverStatus, localStatus] = await Promise.all([
        getWebPushServerStatusWithRetry(),
        getCurrentDeviceWebPushState(),
      ])
      setConfigured(serverStatus.configured)
      setDeviceSubscribed(localStatus.subscribed)
    } catch {
      setNote(
        'No se pudo consultar el estado de notificaciones. Si acabás de iniciar sesión, recargá la página o probá de nuevo en unos segundos.',
      )
      const localStatus = await getCurrentDeviceWebPushState()
      setDeviceSubscribed(localStatus.subscribed)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setSupportCode(getWebPushSupportState().code)
    void refresh()
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
        const r = await subscribeCurrentDeviceToWebPush()
        if (!r.ok) {
          setNote(r.error)
          return
        }
        setDeviceSubscribed(true)
        setNote('Notificaciones activadas en este dispositivo.')
      }
      await refresh()
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : 'Error al cambiar el estado de las notificaciones.')
    } finally {
      setBusy(false)
    }
  }

  if (supportCode === 'pending') {
    return (
      <section className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
              <Bell className="h-4 w-4 text-gray-500" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Notificaciones en el navegador</h2>
          </div>
        </div>
        <p className="text-sm text-gray-500">Comprobando compatibilidad…</p>
      </section>
    )
  }

  if (supportCode !== 'supported') {
    return (
      <section className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
              <Bell className="h-4 w-4 text-gray-500" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Notificaciones en el navegador</h2>
          </div>
        </div>
        <p className="text-sm text-gray-600">{unsupportedExplanation(supportCode)}</p>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="card-header">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              deviceSubscribed ? 'bg-emerald-100' : 'bg-gray-100'
            }`}
          >
            {deviceSubscribed ? (
              <Bell className="h-4 w-4 text-emerald-600" aria-hidden />
            ) : (
              <BellOff className="h-4 w-4 text-gray-500" aria-hidden />
            )}
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Notificaciones en el navegador</h2>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Recibí avisos aunque no tengas el sitio abierto (por ejemplo, cuando se registra una licencia a tu nombre).
        Funciona en la web en computadora y celular; el navegador pedirá permiso la primera vez.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : !configured ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          El servidor aún no tiene configuradas las claves VAPID para push web. Contactá a administración.
        </p>
      ) : (
        <>
          <div
            className={`mb-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              deviceSubscribed
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-gray-50 text-gray-700 border border-gray-200'
            }`}
          >
            {deviceSubscribed ? (
              <>
                <Bell className="h-4 w-4 shrink-0" aria-hidden />
                Activadas en este dispositivo
              </>
            ) : (
              <>
                <BellOff className="h-4 w-4 shrink-0" aria-hidden />
                Desactivadas en este dispositivo
              </>
            )}
          </div>

          {note ? (
            <div className="mb-4 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">{note}</div>
          ) : null}

          <button
            type="button"
            onClick={() => void onToggle()}
            disabled={busy}
            className={
              deviceSubscribed
                ? 'inline-flex items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60'
                : 'btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60'
            }
          >
            <PendingButtonContent
              pending={busy}
              pendingText={deviceSubscribed ? 'Desactivando…' : 'Activando…'}
              idle={
                deviceSubscribed ? (
                  <>
                    <BellOff className="h-4 w-4 shrink-0" aria-hidden />
                    Desactivar
                  </>
                ) : (
                  <>
                    <Bell className="h-4 w-4 shrink-0" aria-hidden />
                    Activar
                  </>
                )
              }
            />
          </button>
        </>
      )}
    </section>
  )
}
