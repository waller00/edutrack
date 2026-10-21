import { dayGroupLabel } from '@/lib/notifications/relative-time'

/** Lo que devuelve `/messages`. Ver `backend/src/services/messaging/conversations.ts`. */
export type Contact = { id: string; name: string; roleLabel: string | null }

export type ConversationListItem = {
  id: string
  starred: boolean
  unread: number
  lastMessageAt: string
  other: Contact | null
  lastMessage: { preview: string; mine: boolean; createdAt: string } | null
}

export type ConversationHeader = { id: string; starred: boolean; other: Contact | null }

export type MessageItem = { id: string; body: string; createdAt: string; mine: boolean; pending?: boolean }

export type MessagesSummary = { unreadConversations: number; unreadMessages: number }

/** Destacados arriba y el resto en "Privado", como en Moodle. Cada uno conserva el orden del servidor. */
export function splitSections(items: readonly ConversationListItem[]) {
  return {
    starred: items.filter((item) => item.starred),
    private: items.filter((item) => !item.starred),
  }
}

/** La línea gris debajo del nombre: lo último que se dijo, con "Tú:" si lo dije yo. */
export function previewOf(item: ConversationListItem): string {
  if (!item.lastMessage) return 'Sin mensajes todavía'
  return item.lastMessage.mine ? `Tú: ${item.lastMessage.preview}` : item.lastMessage.preview
}

/** Iniciales para el círculo: "Leopoldo Giménez" → "LG". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** Cursor de paginado del backend: "fecha|id". */
export function cursorOf(message: Pick<MessageItem, 'id' | 'createdAt'>): string {
  return `${message.createdAt}|${message.id}`
}

/** El último mensaje confirmado por el servidor: desde ahí pregunta el polling. */
export function lastConfirmed(messages: readonly MessageItem[]): MessageItem | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!messages[i].pending) return messages[i]
  }
  return null
}

/**
 * Suma mensajes a los que ya están en pantalla sin repetir ninguno y en orden. Lo que llega del
 * servidor reemplaza al provisorio que mostró quien escribió (mismo id al confirmarse).
 */
export function mergeMessages(current: readonly MessageItem[], incoming: readonly MessageItem[]): MessageItem[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  )
}

/** Mensajes agrupados por día ("Hoy", "Ayer", "Jueves 8 de octubre"), en hora de Uruguay. */
export function groupByDay(messages: readonly MessageItem[], now = new Date()) {
  const groups: Array<{ label: string; items: MessageItem[] }> = []
  for (const message of messages) {
    const label = dayGroupLabel(message.createdAt, now)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(message)
    else groups.push({ label, items: [message] })
  }
  return groups
}
