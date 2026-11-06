'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Maximize2, X } from 'lucide-react'
import { useMessages } from './MessagesProvider'
import ConversationList from './ConversationList'
import ConversationView from './ConversationView'
import SidePanel from '@/components/common/SidePanel'

/**
 * Panel lateral de mensajes, como el de Moodle: la lista de conversaciones y, al elegir una, la
 * conversación en el mismo panel. Atrapa el foco, se cierra con Escape y devuelve el foco al ícono
 * (`SidePanel`).
 */
export default function MessagesDrawer() {
  const { drawerOpen, closeDrawer, activeConversationId, setActiveConversationId, refreshSummary, unreadConversations } = useMessages()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [listVersion, setListVersion] = useState(0)

  const onActivity = () => {
    setListVersion((v) => v + 1)
    void refreshSummary()
  }

  return (
    <SidePanel open={drawerOpen} onClose={closeDrawer} labelledBy="messages-drawer-title" initialFocusRef={closeRef}>
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
    </SidePanel>
  )
}
