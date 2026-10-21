'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import ModuleHeader from '@/components/common/ModuleHeader'
import ConversationList from '@/components/messages/ConversationList'
import ConversationView from '@/components/messages/ConversationView'
import { useOptionalMessages } from '@/components/messages/MessagesProvider'

/** Mensajes en pantalla completa: la lista a la izquierda y la conversación a la derecha. */
export default function MensajesPage() {
  return (
    <RoleGuard permission="messaging.use">
      <MessagesScreen />
    </RoleGuard>
  )
}

function MessagesScreen() {
  const messages = useOptionalMessages()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [listVersion, setListVersion] = useState(0)

  // `?c=<id>` abre esa conversación: es el enlace del push y del panel.
  useEffect(() => {
    const id = new URLSearchParams(globalThis.location.search).get('c')
    if (id) setActiveId(id)
  }, [])

  const open = useCallback((id: string | null) => {
    setActiveId(id)
    globalThis.history.replaceState(null, '', id ? `/mensajes?c=${id}` : '/mensajes')
  }, [])

  const onActivity = useCallback(() => {
    setListVersion((v) => v + 1)
    void messages?.refreshSummary()
  }, [messages])

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <ModuleHeader id="messages" />
      <div className="grid h-[calc(100dvh-14rem)] min-h-[28rem] overflow-hidden rounded-xl border border-slate-200 bg-white md:grid-cols-[22rem_1fr]">
        {/* En el celular se ve una sola columna: la lista o la conversación. */}
        <div className={`min-h-0 flex-col border-slate-100 md:flex md:border-r ${activeId ? 'hidden' : 'flex'}`}>
          <ConversationList onOpen={open} activeId={activeId} refreshKey={listVersion + (messages?.unreadConversations ?? 0)} />
        </div>
        <div className={`min-h-0 flex-col ${activeId ? 'flex' : 'hidden md:flex'}`}>
          {activeId ? (
            <ConversationView key={activeId} conversationId={activeId} onBack={() => open(null)} onActivity={onActivity} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-slate-500">
              <MessageCircle className="h-8 w-8 text-slate-300" aria-hidden />
              <p className="text-sm">Elegí una conversación o buscá a alguien para escribirle.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
