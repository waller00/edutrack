'use client'

import { Bell, BellOff, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import {
  getWebPushServerStatusWithRetry,
  getWebPushSupportState,
  sendWebPushTest,
  subscribeCurrentDeviceToWebPush,
  unsubscribeAllWebPushForUser,
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
  const [subscriptionCount, setSubscriptionCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setNote('')
    try {
      const s = await getWebPushServerStatusWithRetry()
      setConfigured(s.configured)
      setSubscriptionCount(s.subscriptionCount)
    } catch {
      setNote(
        'No se pudo consultar el estado de notificaciones. Si acabás de iniciar sesión, recargá la página o probá de nuevo en unos segundos.',
      )
      // No poner el contador en 0: suele confundir (la suscripción en servidor puede seguir existiendo).
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setSupportCode(getWebPushSupportState().code)
    void refresh()
  }, [refresh])

  async function onEnable() {
    setBusy(true)
    setNote('')
    try {
      const r = await subscribeCurrentDeviceToWebPush()
      if (!r.ok) {
        setNote(r.error)
        return
      }
      setNote('Notificaciones activadas en este dispositivo.')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function onDisableAll() {
    if (!confirm('¿Quitar todas las suscripciones push de tu cuenta (todos los dispositivos)?')) return
    setBusy(true)
    setNote('')
    try {
      await unsubscribeAllWebPushForUser()
      setNote('Suscripciones eliminadas.')
      await refresh()
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : 'Error al desactivar.')
    } finally {
      setBusy(false)
    }
  }

  async function onTest() {
    setTestBusy(true)
    setNote('')
    try {
      const r = await sendWebPushTest()
      setNote(
        r.sent > 0
          ? `Enviada notificación de prueba (${r.sent} dispositivo(s)).`
          : 'No hay suscripciones activas o el envío falló en todos los dispositivos.',
      )
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : 'No se pudo enviar la prueba.')
    } finally {
      setTestBusy(false)
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
          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
            <Bell className="h-4 w-4 text-emerald-600" aria-hidden />
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
          <p className="text-sm text-gray-700 mb-4">
            Dispositivos registrados: <strong>{subscriptionCount}</strong>
          </p>

          {note ? (
            <div className="mb-4 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">{note}</div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void onEnable()}
              disabled={busy}
              className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <PendingButtonContent
                pending={busy}
                pendingText="Activando…"
                idle={
                  <>
                    <Bell className="h-4 w-4 shrink-0" aria-hidden />
                    Activar en este dispositivo
                  </>
                }
              />
            </button>
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={testBusy || subscriptionCount === 0}
              title="Envía un aviso de prueba solo a tus dispositivos registrados (útil para soporte y verificación)."
              className="inline-flex items-center justify-center gap-2 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PendingButtonContent
                pending={testBusy}
                pendingText="Enviando…"
                idle={
                  <>
                    <Send className="h-4 w-4 shrink-0" aria-hidden />
                    Enviar notificación de prueba
                  </>
                }
              />
            </button>
            <button
              type="button"
              onClick={() => void onDisableAll()}
              disabled={busy || subscriptionCount === 0}
              className="inline-flex items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <BellOff className="h-4 w-4 shrink-0" aria-hidden />
              Quitar todas
            </button>
          </div>
        </>
      )}
    </section>
  )
}
