'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCheck, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { PendingButtonContent } from '@/components/PendingButtonContent'

type InAppItem = {
  id: string
  type: string
  title: string
  body: string
  actionUrl: string | null
  readAt: string | null
  createdAt: string
}

export default function NotificationsPage() {
  const [items, setItems] = useState<InAppItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    setLoading(true)
    try {
      const r = await api<{ items: InAppItem[] }>('/notifications/in-app?take=80')
      setItems(r.items)
    } catch (e: unknown) {
      const st = (e as { status?: number })?.status
      if (st === 401) {
        window.location.href = '/login'
        return
      }
      setErr('No se pudieron cargar los avisos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function markRead(id: string) {
    try {
      await api(`/notifications/in-app/${id}/read`, { method: 'PATCH' })
      setItems((prev) =>
        prev.map((it) =>
          it.id === id ? { ...it, readAt: new Date().toISOString() } : it,
        ),
      )
    } catch {
      /* noop */
    }
  }

  async function markAllRead() {
    setMarkingAll(true)
    try {
      await api('/notifications/in-app/read-all', { method: 'POST' })
      const now = new Date().toISOString()
      setItems((prev) => prev.map((it) => ({ ...it, readAt: it.readAt ?? now })))
    } catch {
      /* noop */
    } finally {
      setMarkingAll(false)
    }
  }

  const unread = items.filter((it) => !it.readAt).length

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Avisos</h1>
          <p className="mt-1 text-sm text-gray-600">
            Notificaciones guardadas en tu cuenta.
          </p>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={markingAll}
            className="btn-secondary inline-flex items-center gap-2 text-sm"
          >
            <PendingButtonContent
              pending={markingAll}
              pendingText="Marcando…"
              idle={
                <>
                  <CheckCheck className="h-4 w-4" aria-hidden />
                  Marcar todas leídas
                </>
              }
            />
          </button>
        )}
      </div>

      {err && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {err}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/80 py-16 text-center">
          <Bell className="mb-3 h-10 w-10 text-gray-300" aria-hidden />
          <p className="text-sm font-medium text-gray-700">No hay avisos todavía</p>
          <p className="mt-1 max-w-sm text-xs text-gray-500">
            Cuando la institución registre una licencia a tu nombre, verás un aviso acá y en Mis
            licencias.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const isUnread = !it.readAt
            const created = new Date(it.createdAt)
            const dateStr = created.toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })
            return (
              <li
                key={it.id}
                className={`rounded-xl border px-4 py-3 transition-shadow ${
                  isUnread
                    ? 'border-emerald-200 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{it.title}</span>
                      {isUnread && (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Nuevo
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-700">{it.body}</p>
                    <p className="mt-2 text-xs text-gray-500">{dateStr}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {it.actionUrl && (
                      <a
                        href={it.actionUrl}
                        onClick={() => {
                          if (isUnread) void markRead(it.id)
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
                      >
                        Abrir
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    )}
                    {isUnread && (
                      <button
                        type="button"
                        onClick={() => void markRead(it.id)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Marcar leída
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
