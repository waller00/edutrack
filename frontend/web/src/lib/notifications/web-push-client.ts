import { api } from '@/lib/api/client'

const SW_PATH = '/sw.js'

/** Motivo por el que no hay push web (útil para mensajes en UI; no es solo “navegador viejo”). */
export type WebPushSupportCode =
  | 'supported'
  | 'pending'
  | 'insecure-context'
  | 'no-service-worker'
  | 'no-notification'
  | 'no-push-manager'

/**
 * Push web y service workers exigen contexto seguro (HTTPS), salvo localhost.
 * Si entrás por http://IP:3000 en testing, el navegador oculta PushManager: no es el .env.
 */
export function getWebPushSupportState(): { code: WebPushSupportCode } {
  if (typeof window === 'undefined') return { code: 'pending' }
  if (!globalThis.isSecureContext) return { code: 'insecure-context' }
  if (!('serviceWorker' in navigator)) return { code: 'no-service-worker' }
  if (!('Notification' in globalThis)) return { code: 'no-notification' }
  if (!('PushManager' in globalThis)) return { code: 'no-push-manager' }
  return { code: 'supported' }
}

export function isWebPushSupported(): boolean {
  return getWebPushSupportState().code === 'supported'
}

/** Convierte la clave pública VAPID (base64 URL) al formato que pide `applicationServerKey`. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = globalThis.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function getWebPushServerStatus(): Promise<{
  configured: boolean
  subscriptionCount: number
}> {
  return api('/notifications/web-push/status')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reintenta por si la cookie de sesión aún no aplica en el primer request tras el login. */
export async function getWebPushServerStatusWithRetry(
  maxAttempts = 4,
  pauseMs = 350,
): Promise<{ configured: boolean; subscriptionCount: number }> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await getWebPushServerStatus()
    } catch (e) {
      lastError = e
      if (attempt < maxAttempts - 1) {
        await delay(pauseMs)
        continue
      }
    }
  }
  throw lastError
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in globalThis)) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.requestPermission()
}

/**
 * Registra el service worker, crea la suscripción push y la guarda en el backend.
 */
export async function subscribeCurrentDeviceToWebPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const perm = await requestNotificationPermission()
    if (perm !== 'granted') {
      return { ok: false, error: 'Tenés que permitir notificaciones en el navegador para activarlas.' }
    }

    const { publicKey } = await api<{ publicKey: string }>('/notifications/web-push/vapid-public-key')

    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
    await reg.update()
    const ready = await navigator.serviceWorker.ready

    const applicationServerKey = urlBase64ToUint8Array(publicKey) as BufferSource
    const sub = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })

    const subscriptionJson = sub.toJSON()
    if (!subscriptionJson.endpoint || !subscriptionJson.keys?.p256dh || !subscriptionJson.keys?.auth) {
      return { ok: false, error: 'No se pudo obtener la suscripción del navegador.' }
    }

    await api('/notifications/web-push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription: subscriptionJson,
        userAgent: navigator.userAgent.slice(0, 500),
      }),
    })

    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al activar notificaciones.'
    return { ok: false, error: msg }
  }
}

/** Indica si este navegador tiene una suscripción push activa. */
export async function getCurrentDeviceWebPushState(): Promise<{ subscribed: boolean }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
    if (!reg) return { subscribed: false }
    const sub = await reg.pushManager.getSubscription()
    return { subscribed: sub != null }
  } catch {
    return { subscribed: false }
  }
}

/** Quita la suscripción push solo en este navegador. */
export async function unsubscribeCurrentDeviceFromWebPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH)
  if (reg) {
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const endpoint = sub.endpoint
      await sub.unsubscribe()
      await api('/notifications/web-push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      })
      return
    }
  }
}

/** Quita la suscripción en este navegador y todas las entradas del usuario en el servidor. */
export async function unsubscribeAllWebPushForUser(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (reg) {
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
  }
  await api('/notifications/web-push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({}),
  })
}

export async function sendWebPushTest(): Promise<{ sent: number; failed: number }> {
  return api('/notifications/web-push/test', { method: 'POST', body: JSON.stringify({}) })
}
