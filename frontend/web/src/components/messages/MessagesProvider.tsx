'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import type { MessagesSummary } from '@/lib/messages/conversations'

/** Cada cuánto se pregunta si hay mensajes nuevos, con la pestaña a la vista. */
export const SUMMARY_POLL_MS = 15_000
const REFOCUS_MIN_MS = 5_000

export type MessagesContextValue = {
  /** ¿El perfil tiene `messaging.use`? Sin eso no hay ícono ni panel. */
  enabled: boolean
  unreadConversations: number
  refreshSummary: () => Promise<void>
  drawerOpen: boolean
  /** Abre el panel; con un id, directo en esa conversación. */
  openDrawer: (conversationId?: string | null) => void
  closeDrawer: () => void
  activeConversationId: string | null
  setActiveConversationId: (id: string | null) => void
}

const MessagesContext = createContext<MessagesContextValue | null>(null)

/**
 * Estado de la mensajería para toda la app: el ícono del encabezado, el panel y la página
 * `/mensajes` comparten el contador y la conversación abierta.
 *
 * El contador se mantiene al día solo, igual que la campana pero más seguido: cada 15 s con la
 * pestaña a la vista, al volver a la pestaña y cuando el service worker avisa que llegó un push.
 */
export function MessagesProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = useOptionalAuth()
  const enabled = hasPermission(auth?.me, 'messaging.use')
  const [unreadConversations, setUnreadConversations] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const lastFetch = useRef(0)
  const inFlight = useRef(false)

  const refreshSummary = useCallback(async () => {
    if (!enabled || inFlight.current) return
    inFlight.current = true
    lastFetch.current = Date.now()
    try {
      const res = await api<MessagesSummary>('/messages/summary')
      setUnreadConversations(typeof res?.unreadConversations === 'number' ? res.unreadConversations : 0)
    } catch {
      // Sin conexión queda lo último que se vio; el próximo intento lo corrige.
    } finally {
      inFlight.current = false
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void refreshSummary()
    const visible = () => globalThis.document?.visibilityState !== 'hidden'
    const interval = setInterval(() => {
      if (visible()) void refreshSummary()
    }, SUMMARY_POLL_MS)
    const onReturn = () => {
      if (visible() && Date.now() - lastFetch.current > REFOCUS_MIN_MS) void refreshSummary()
    }
    const onWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'edutrack:push') void refreshSummary()
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
  }, [enabled, refreshSummary])

  const openDrawer = useCallback((conversationId?: string | null) => {
    setActiveConversationId(conversationId ?? null)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setActiveConversationId(null)
    void refreshSummary()
  }, [refreshSummary])

  const value = useMemo<MessagesContextValue>(
    () => ({
      enabled,
      unreadConversations,
      refreshSummary,
      drawerOpen,
      openDrawer,
      closeDrawer,
      activeConversationId,
      setActiveConversationId,
    }),
    [enabled, unreadConversations, refreshSummary, drawerOpen, openDrawer, closeDrawer, activeConversationId],
  )

  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
}

export function useMessages(): MessagesContextValue {
  const value = useContext(MessagesContext)
  if (!value) throw new Error('useMessages fuera de <MessagesProvider>')
  return value
}

export function useOptionalMessages(): MessagesContextValue | null {
  return useContext(MessagesContext)
}
