'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Loader2, Search, Star } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { relativeTime } from '@/lib/notifications/relative-time'
import {
  previewOf,
  splitSections,
  type Contact,
  type ConversationHeader,
  type ConversationListItem,
} from '@/lib/messages/conversations'
import Avatar from './Avatar'

type Props = {
  /** Abrir una conversación (existente o recién creada con un contacto). */
  onOpen: (conversationId: string) => void
  activeId?: string | null
  /** Cambia cuando el contador de no leídos cambia: la lista se vuelve a pedir. */
  refreshKey?: number
}

/**
 * Lista de conversaciones, como el panel de Moodle: buscador, "Destacados" y "Privado". Al buscar
 * aparecen también los contactos, para empezar una conversación con alguien nuevo.
 */
export default function ConversationList({ onOpen, activeId = null, refreshKey = 0 }: Readonly<Props>) {
  const [query, setQuery] = useState('')
  const search = useDebouncedValue(query.trim(), 300)
  const [items, setItems] = useState<ConversationListItem[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<{ starred: boolean; private: boolean }>({ starred: false, private: false })

  const load = useCallback(async () => {
    try {
      const q = encodeURIComponent(search)
      const [list, people] = await Promise.all([
        api<{ data: ConversationListItem[] }>(`/messages/conversations?q=${q}`),
        search ? api<{ data: Contact[] }>(`/messages/contacts?q=${q}`) : Promise.resolve({ data: [] as Contact[] }),
      ])
      setItems(list?.data ?? [])
      setContacts(people?.data ?? [])
      setError(null)
    } catch {
      setError('No se pudieron cargar los mensajes.')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function startWith(contact: Contact) {
    const existing = items.find((item) => item.other?.id === contact.id)
    if (existing) {
      onOpen(existing.id)
      return
    }
    setStarting(contact.id)
    try {
      const res = await api<{ data: ConversationHeader }>('/messages/conversations', {
        method: 'POST',
        body: JSON.stringify({ userId: contact.id }),
      })
      onOpen(res.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la conversación.')
    } finally {
      setStarting(null)
    }
  }

  const sections = splitSections(items)
  // Los contactos con los que ya hay conversación aparecen arriba, en la lista: no se repiten.
  const withConversation = new Set(items.map((item) => item.other?.id))
  const newContacts = contacts.filter((contact) => !withConversation.has(contact.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-slate-100 p-3">
        <label htmlFor="messages-search" className="sr-only">Buscar personas o conversaciones</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id="messages-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar personas"
            autoComplete="off"
            className="input-field pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <p role="status" className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
          </p>
        )}
        {error && <p role="alert" className="m-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {!loading && (
          <>
            <Section
              title="Destacados"
              items={sections.starred}
              collapsed={collapsed.starred}
              onToggle={() => setCollapsed((c) => ({ ...c, starred: !c.starred }))}
              onOpen={onOpen}
              activeId={activeId}
              empty="Destacá una conversación con la estrella para tenerla acá."
            />
            <Section
              title="Privado"
              items={sections.private}
              collapsed={collapsed.private}
              onToggle={() => setCollapsed((c) => ({ ...c, private: !c.private }))}
              onOpen={onOpen}
              activeId={activeId}
              empty={search ? 'No hay conversaciones con ese nombre.' : 'Todavía no tenés conversaciones. Buscá a alguien para escribirle.'}
            />
            {search && (
              <section aria-labelledby="messages-contacts-title" className="border-t border-slate-100">
                <h3 id="messages-contacts-title" className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Contactos
                </h3>
                {newContacts.length === 0 ? (
                  <p className="px-4 pb-4 text-sm text-slate-500">Nadie más con ese nombre.</p>
                ) : (
                  <ul>
                    {newContacts.map((contact) => (
                      <li key={contact.id}>
                        <button
                          type="button"
                          onClick={() => void startWith(contact)}
                          disabled={starting === contact.id}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 disabled:opacity-60"
                        >
                          <Avatar name={contact.name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">{contact.name}</span>
                            {contact.roleLabel && <span className="block text-xs text-slate-500">{contact.roleLabel}</span>}
                          </span>
                          <span className="text-xs font-medium text-emerald-700">Escribir</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  items,
  collapsed,
  onToggle,
  onOpen,
  activeId,
  empty,
}: Readonly<{
  title: string
  items: ConversationListItem[]
  collapsed: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  activeId: string | null
  empty: string
}>) {
  const listId = `messages-section-${title.toLowerCase()}`
  return (
    <section className="border-b border-slate-100">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={listId}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50"
      >
        <ChevronDown className={`h-4 w-4 text-slate-500 transition ${collapsed ? '-rotate-90' : ''}`} aria-hidden />
        {title} <span className="font-normal text-slate-500">({items.length})</span>
      </button>
      {!collapsed && (
        <div id={listId}>
          {items.length === 0 ? (
            <p className="px-4 pb-3 text-sm text-slate-500">{empty}</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <ConversationRow item={item} active={item.id === activeId} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function ConversationRow({ item, active, onOpen }: Readonly<{ item: ConversationListItem; active: boolean; onOpen: (id: string) => void }>) {
  const name = item.other?.name ?? 'Usuario'
  const unread = item.unread > 0
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      aria-current={active ? 'true' : undefined}
      aria-label={`${name}${unread ? `, ${item.unread} sin leer` : ''}`}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${active ? 'bg-emerald-50' : ''}`}
    >
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm ${unread ? 'font-bold text-slate-950' : 'font-semibold text-slate-800'}`}>
            {name}
            {item.starred && <Star className="ml-1 inline h-3 w-3 fill-amber-400 text-amber-400" aria-label="Destacada" />}
          </span>
          {item.lastMessage && (
            <span className="shrink-0 text-xs text-slate-500">{relativeTime(item.lastMessage.createdAt)}</span>
          )}
        </span>
        {item.other?.roleLabel && <span className="block text-xs text-slate-500">{item.other.roleLabel}</span>}
        <span className="mt-0.5 flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-sm ${unread ? 'text-slate-900' : 'text-slate-500'}`}>{previewOf(item)}</span>
          {unread && (
            <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-semibold text-white">
              {item.unread > 99 ? '99+' : item.unread}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
