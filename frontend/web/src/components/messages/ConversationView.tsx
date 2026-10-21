'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Send, Star } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import {
  cursorOf,
  groupByDay,
  lastConfirmed,
  mergeMessages,
  type ConversationHeader,
  type MessageItem,
} from '@/lib/messages/conversations'
import Avatar from './Avatar'

/** Con la conversación abierta y la pestaña a la vista, cada cuánto se pregunta si hay mensajes nuevos. */
export const CONVERSATION_POLL_MS = 3_000
const MAX_LENGTH = 4000

type Props = {
  conversationId: string
  /** En el panel, volver a la lista. En la página de dos columnas no hace falta. */
  onBack?: () => void
  /** Se mandó o se leyó algo: la lista y el contador se ponen al día. */
  onActivity?: () => void
}

/** Una conversación: burbujas propias a la derecha, ajenas a la izquierda, separadas por día. */
export default function ConversationView({ conversationId, onBack, onActivity }: Readonly<Props>) {
  const [header, setHeader] = useState<ConversationHeader | null>(null)
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<MessageItem[]>([])
  messagesRef.current = messages
  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const markRead = useCallback(async () => {
    try {
      await api(`/messages/conversations/${conversationId}/read`, { method: 'POST' })
      onActivityRef.current?.()
    } catch {
      // Se marca en el próximo intento.
    }
  }, [conversationId])

  // Carga inicial: cabecera y últimos mensajes, y queda leída.
  useEffect(() => {
    let alive = true
    setLoading(true)
    setMessages([])
    setError(null)
    Promise.all([
      api<{ data: ConversationHeader }>(`/messages/conversations/${conversationId}`),
      api<{ data: MessageItem[]; hasMore: boolean }>(`/messages/conversations/${conversationId}/messages`),
    ])
      .then(([head, list]) => {
        if (!alive) return
        setHeader(head.data)
        setMessages(list.data)
        setHasMore(list.hasMore)
        void markRead()
        requestAnimationFrame(scrollToEnd)
      })
      .catch(() => {
        if (alive) setError('No se pudo abrir la conversación.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [conversationId, markRead, scrollToEnd])

  // Casi al instante: con la pestaña a la vista se pregunta por lo nuevo cada 3 s.
  useEffect(() => {
    if (loading) return
    const tick = async () => {
      if (globalThis.document?.visibilityState === 'hidden') return
      const last = lastConfirmed(messagesRef.current)
      const after = last ? `?after=${encodeURIComponent(cursorOf(last))}` : ''
      try {
        const res = await api<{ data: MessageItem[] }>(`/messages/conversations/${conversationId}/messages${after}`)
        const fresh = res.data.filter((m) => !messagesRef.current.some((current) => current.id === m.id))
        if (fresh.length === 0) return
        setMessages((current) => mergeMessages(current, fresh))
        requestAnimationFrame(scrollToEnd)
        if (fresh.some((m) => !m.mine)) void markRead()
      } catch {
        // Un corte de red no rompe la conversación: el próximo intento trae lo que falte.
      }
    }
    const interval = setInterval(() => void tick(), CONVERSATION_POLL_MS)
    return () => clearInterval(interval)
  }, [conversationId, loading, markRead, scrollToEnd])

  async function loadOlder() {
    const first = messages.find((m) => !m.pending)
    if (!first) return
    setLoadingOlder(true)
    const el = scrollRef.current
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0
    try {
      const res = await api<{ data: MessageItem[]; hasMore: boolean }>(
        `/messages/conversations/${conversationId}/messages?before=${encodeURIComponent(cursorOf(first))}`,
      )
      setMessages((current) => mergeMessages(current, res.data))
      setHasMore(res.hasMore)
      // Mantiene a la vista lo que se estaba leyendo.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - fromBottom
      })
    } catch {
      setError('No se pudieron cargar los mensajes anteriores.')
    } finally {
      setLoadingOlder(false)
    }
  }

  async function send() {
    const body = draft.trim()
    if (!body) return
    const tempId = `pending-${Date.now()}`
    const pending: MessageItem = { id: tempId, body, createdAt: new Date().toISOString(), mine: true, pending: true }
    setDraft('')
    setError(null)
    setMessages((current) => [...current, pending])
    requestAnimationFrame(scrollToEnd)
    try {
      const res = await api<{ data: MessageItem }>(`/messages/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      setMessages((current) => mergeMessages(current.filter((m) => m.id !== tempId), [res.data]))
      onActivityRef.current?.()
    } catch (err) {
      setMessages((current) => current.filter((m) => m.id !== tempId))
      setDraft(body)
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.')
    }
  }

  async function toggleStar() {
    if (!header) return
    const starred = !header.starred
    setHeader({ ...header, starred })
    try {
      await api(`/messages/conversations/${conversationId}/star`, { method: 'PUT', body: JSON.stringify({ starred }) })
      onActivityRef.current?.()
    } catch {
      setHeader((current) => (current ? { ...current, starred: !starred } : current))
    }
  }

  const name = header?.other?.name ?? 'Conversación'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5">
        {onBack && (
          <button type="button" onClick={onBack} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Volver a las conversaciones">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <Avatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{name}</h3>
          {header?.other?.roleLabel && <p className="text-xs text-slate-500">{header.other.roleLabel}</p>}
        </div>
        {header && (
          <button
            type="button"
            onClick={() => void toggleStar()}
            aria-pressed={header.starred}
            aria-label={header.starred ? 'Quitar de destacados' : 'Destacar conversación'}
            className="rounded-lg p-2 hover:bg-slate-100"
          >
            <Star className={`h-4 w-4 ${header.starred ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} aria-hidden />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-3 py-3" aria-live="polite">
        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
          </p>
        )}
        {!loading && hasMore && (
          <div className="mb-3 text-center">
            <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-60">
              {loadingOlder ? 'Cargando…' : 'Cargar mensajes anteriores'}
            </button>
          </div>
        )}
        {!loading && messages.length === 0 && !error && (
          <p className="py-6 text-center text-sm text-slate-500">Todavía no hay mensajes. Escribí el primero.</p>
        )}
        {groupByDay(messages).map((group) => (
          <div key={group.label} className="mb-3">
            <p className="my-2 text-center text-xs font-medium text-slate-500">{group.label}</p>
            <ul className="space-y-1.5">
              {group.items.map((message) => (
                <li key={message.id} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      message.mine ? 'rounded-br-sm bg-emerald-600 text-white' : 'rounded-bl-sm bg-white text-slate-900'
                    } ${message.pending ? 'opacity-70' : ''}`}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <p className={`mt-0.5 text-right text-[11px] ${message.mine ? 'text-emerald-100' : 'text-slate-400'}`}>
                      {message.pending ? 'Enviando…' : formatTimeInUruguay(message.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {error && <p role="alert" className="border-t border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form
        className="flex items-end gap-2 border-t border-slate-100 p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <label htmlFor={`message-draft-${conversationId}`} className="sr-only">Escribí un mensaje</label>
        <textarea
          id={`message-draft-${conversationId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(event) => {
            // Enter manda; Shift+Enter hace un salto de línea.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder="Escribí un mensaje…"
          disabled={loading || (Boolean(error) && !header)}
          className="input-field max-h-32 min-h-[2.5rem] flex-1 resize-none"
        />
        <button type="submit" disabled={!draft.trim()} className="btn-primary h-10 w-10 shrink-0 justify-center p-0 disabled:opacity-50" aria-label="Enviar">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  )
}
