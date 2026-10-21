'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Maximize2, X } from 'lucide-react'
import { useMessages } from './MessagesProvider'
import ConversationList from './ConversationList'
import ConversationView from './ConversationView'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]'

/**
 * Panel lateral de mensajes, como el de Moodle: la lista de conversaciones y, al elegir una, la
 * conversación en el mismo panel. Atrapa el foco, se cierra con Escape y devuelve el foco al ícono.
 */
export default function MessagesDrawer() {
  const { drawerOpen, closeDrawer, activeConversationId, setActiveConversationId, refreshSummary, unreadConversations } = useMessages()
  const [portalReady, setPortalReady] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [listVersion, setListVersion] = useState(0)

  useEffect(() => setPortalReady(true), [])

  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer()
      if (event.key !== 'Tab') return
      const elements = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!elements?.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [drawerOpen, closeDrawer])

  if (!drawerOpen || !portalReady) return null

  const onActivity = () => {
    setListVersion((v) => v + 1)
    void refreshSummary()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onMouseDown={(e) => e.target === e.currentTarget && closeDrawer()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="messages-drawer-title"
        className="flex h-[100dvh] w-full max-w-md flex-col bg-white shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 id="messages-drawer-title" className="text-base font-semibold text-slate-900">Mensajes</h2>
          <div className="flex items-center gap-1">
            <Link
              href={activeConversationId ? `/mensajes?c=${activeConversationId}` : '/mensajes'}
              onClick={closeDrawer}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Abrir en pantalla completa"
              title="Abrir en pantalla completa"
            >
              <Maximize2 className="h-4 w-4" aria-hidden />
            </Link>
            <button ref={closeRef} type="button" onClick={closeDrawer} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar mensajes">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>
        {activeConversationId ? (
          <ConversationView
            key={activeConversationId}
            conversationId={activeConversationId}
            onBack={() => {
              setActiveConversationId(null)
              setListVersion((v) => v + 1)
            }}
            onActivity={onActivity}
          />
        ) : (
          <ConversationList onOpen={setActiveConversationId} refreshKey={listVersion + unreadConversations} />
        )}
      </div>
    </div>,
    document.body,
  )
}
