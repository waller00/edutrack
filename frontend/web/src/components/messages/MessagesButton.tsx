'use client'

import { MessageCircle } from 'lucide-react'
import { useOptionalMessages } from './MessagesProvider'

/** Ícono de mensajes del encabezado, al lado de la campana. Sin `messaging.use` no aparece. */
export default function MessagesButton() {
  const messages = useOptionalMessages()
  if (!messages?.enabled) return null
  const { unreadConversations, openDrawer, drawerOpen } = messages
  const label = unreadConversations > 0 ? `Mensajes, ${unreadConversations} conversaciones sin leer` : 'Mensajes'
  return (
    <button
      type="button"
      onClick={() => openDrawer()}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={drawerOpen}
      className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      <MessageCircle className="h-5 w-5" aria-hidden />
      {unreadConversations > 0 && (
        <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-4 text-white">
          {unreadConversations > 99 ? '99+' : unreadConversations}
        </span>
      )}
    </button>
  )
}
