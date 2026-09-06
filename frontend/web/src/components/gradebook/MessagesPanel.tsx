'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessagesSquare, Send } from 'lucide-react'
import { api } from '@/lib/api/client'
import { getRoleLabel } from '@/lib/roles/display'

type Message = {
  id: string
  body: string
  authorRoleCode: string
  author: { id: string; name: string | null } | null
  period: { id: string; name: string } | null
  parentId: string | null
  createdAt: string
}

type Thread = { root: Message; replies: Message[] }

/**
 * Agrupa el hilo: cada mensaje raíz con sus respuestas, en orden.
 *
 * Una respuesta cuyo padre no está en el lote (por el tope de 500) se muestra como raíz en vez de
 * desaparecer: perder un mensaje del intercambio es peor que mostrarlo fuera de su hilo.
 */
export function buildThreads(messages: readonly Message[]): Thread[] {
  const byId = new Set(messages.map((m) => m.id))
  const roots = messages.filter((m) => !m.parentId || !byId.has(m.parentId))
  return roots.map((root) => ({
    root,
    replies: messages.filter((m) => m.parentId === root.id),
  }))
}

function Bubble({ message }: { message: Message }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="flex flex-wrap items-baseline gap-2 text-xs text-gray-500">
        <span className="font-medium text-gray-900">{message.author?.name ?? 'Usuario dado de baja'}</span>
        <span>{getRoleLabel(message.authorRoleCode)}</span>
        {message.period && <span>· {message.period.name}</span>}
        <span className="ml-auto">{new Date(message.createdAt).toLocaleString('es-UY')}</span>
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{message.body}</p>
    </div>
  )
}

/** Espacio de intercambio de la libreta (RF-090). */
export default function MessagesPanel({
  gradeBookId,
  readOnly = false,
}: {
  gradeBookId: string
  readOnly?: boolean
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: Message[] }>(`/gradebook/${gradeBookId}/messages`)
      setMessages(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el intercambio')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  async function send() {
    if (draft.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await api(`/gradebook/${gradeBookId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: draft.trim(), ...(replyTo ? { parentId: replyTo } : {}) }),
      })
      setDraft('')
      setReplyTo(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo publicar')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando intercambio…
      </p>
    )
  }

  const threads = buildThreads(messages)

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-gray-400" aria-hidden />
        <h2 className="text-sm font-semibold text-gray-900">Observaciones y mensajes</h2>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {threads.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
          Todavía no hay mensajes. Es el espacio de intercambio con adscripción, dirección e inspección.
        </p>
      ) : (
        <ul className="space-y-3">
          {threads.map((thread) => (
            <li key={thread.root.id} className="space-y-2">
              <Bubble message={thread.root} />
              {thread.replies.length > 0 && (
                <ul className="ml-6 space-y-2 border-l-2 border-gray-100 pl-3">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Bubble message={reply} />
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setReplyTo(replyTo === thread.root.id ? null : thread.root.id)}
                className="ml-6 text-xs text-emerald-700 hover:underline"
              >
                {replyTo === thread.root.id ? 'Cancelar respuesta' : 'Responder'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {readOnly ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          El ciclo está cerrado: el intercambio queda como registro y no admite mensajes nuevos.
        </p>
      ) : (
      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
        {replyTo && <p className="text-xs text-gray-500">Respondiendo a un mensaje del hilo.</p>}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          aria-label="Escribir un mensaje"
          placeholder="Escribí una observación o una consulta…"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || draft.trim() === ''}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          Publicar
        </button>
      </div>
      )}
    </section>
  )
}
