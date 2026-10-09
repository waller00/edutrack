'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api/client'

export type InAppNotification = {
  id: string
  type: string
  title: string
  body: string
  actionUrl: string | null
  readAt: string | null
  createdAt: string
}

type Summary = { unreadCount?: number; items?: InAppNotification[] }

export type NotificationsContextValue = {
  unreadCount: number
  /** Los últimos avisos, para el panel de la campana. */
  items: InAppNotification[]
  loaded: boolean
  refresh: () => Promise<void>
  markRead: (item: Pick<InAppNotification, 'id' | 'readAt'>) => Promise<void>
  markAllRead: () => Promise<void>
  /** Marca leído y lleva a la pantalla del aviso, sin recargar la página. */
  open: (item: InAppNotification) => Promise<void>
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  /** Avisos que llegaron mientras se usaba la app (el cartelito). */
  toast: InAppNotification[] | null
  dismissToast: () => void
}

/** Cada cuánto se pregunta con la pestaña a la vista. */
export const POLL_MS = 60_000
/** Al volver a la pestaña se pregunta enseguida, salvo que se haya preguntado hace muy poco. */
const REFOCUS_MIN_MS = 15_000
const SUMMARY_PATH = '/notifications/in-app/summary?take=8'

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

/**
 * Estado de los avisos para toda la app: la campana, el cartelito y la página de avisos leen y
 * marcan lo mismo, así el número baja apenas se lee algo, en cualquier lado.
 *
 * Se mantiene al día solo: pregunta cada minuto con la pestaña a la vista, al volver a la pestaña
 * y cuando el service worker avisa que llegó un push.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [unreadCount, setUnreadCount] = useState(0)
  const [items, setItems] = useState<InAppNotification[]>([])
  const [loaded, setLoaded] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [toast, setToast] = useState<InAppNotification[] | null>(null)
  const knownIds = useRef<Set<string> | null>(null)
  const lastFetch = useRef(0)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    lastFetch.current = Date.now()
    try {
      const res = await api<Summary>(SUMMARY_PATH)
      const list = Array.isArray(res?.items) ? res.items : []
      setItems(list)
      setUnreadCount(typeof res?.unreadCount === 'number' ? res.unreadCount : list.filter((item) => !item.readAt).length)
      setLoaded(true)
      // El cartelito es para lo que llega mientras se usa la app: en la primera carga no hay.
      const known = knownIds.current
      if (known) {
        const fresh = list.filter((item) => !item.readAt && !known.has(item.id))
        if (fresh.length > 0) setToast(fresh)
      }
      knownIds.current = new Set([...(known ?? []), ...list.map((item) => item.id)])
    } catch {
      // Sin conexión se conserva lo último que se vio; el próximo intento lo corrige.
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const visible = () => globalThis.document?.visibilityState !== 'hidden'
    const interval = setInterval(() => {
      if (visible()) void refresh()
    }, POLL_MS)
    const onReturn = () => {
      if (visible() && Date.now() - lastFetch.current > REFOCUS_MIN_MS) void refresh()
    }
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'edutrack:push') void refresh()
    }
    const worker = globalThis.navigator?.serviceWorker
    globalThis.document?.addEventListener('visibilitychange', onReturn)
    globalThis.addEventListener?.('focus', onReturn)
    worker?.addEventListener('message', onWorkerMessage)
    return () => {
      clearInterval(interval)
      globalThis.document?.removeEventListener('visibilitychange', onReturn)
      globalThis.removeEventListener?.('focus', onReturn)
      worker?.removeEventListener('message', onWorkerMessage)
    }
  }, [refresh])

  const markRead = useCallback(
    async (item: Pick<InAppNotification, 'id' | 'readAt'>) => {
      if (item.readAt) return
      const now = new Date().toISOString()
      setItems((list) => list.map((it) => (it.id === item.id ? { ...it, readAt: now } : it)))
      setUnreadCount((count) => Math.max(0, count - 1))
      setToast((current) => current?.filter((it) => it.id !== item.id) || null)
      try {
        await api(`/notifications/in-app/${item.id}/read`, { method: 'PATCH' })
      } catch {
        void refresh()
      }
    },
    [refresh],
  )

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setItems((list) => list.map((it) => ({ ...it, readAt: it.readAt ?? now })))
    setUnreadCount(0)
    setToast(null)
    try {
      await api('/notifications/in-app/read-all', { method: 'POST' })
    } catch {
      void refresh()
    }
  }, [refresh])

  const open = useCallback(
    async (item: InAppNotification) => {
      setPanelOpen(false)
      setToast(null)
      void markRead(item)
      if (!item.actionUrl) return
      if (/^https?:\/\//i.test(item.actionUrl)) globalThis.location.assign(item.actionUrl)
      else router.push(item.actionUrl)
    },
    [markRead, router],
  )

  const dismissToast = useCallback(() => setToast(null), [])

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unreadCount,
      items,
      loaded,
      refresh,
      markRead,
      markAllRead,
      open,
      panelOpen,
      setPanelOpen,
      toast: toast && toast.length > 0 ? toast : null,
      dismissToast,
    }),
    [unreadCount, items, loaded, refresh, markRead, markAllRead, open, panelOpen, toast, dismissToast],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext)
  if (!context) throw new Error('useNotifications debe usarse dentro de <NotificationsProvider>')
  return context
}

/** Como `useNotifications`, pero `null` fuera del proveedor (pantallas sueltas, tests). */
export function useOptionalNotifications(): NotificationsContextValue | null {
  return useContext(NotificationsContext)
}
