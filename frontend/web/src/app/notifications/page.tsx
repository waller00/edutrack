'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check, CheckCheck, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import RoleGuard from '@/components/auth/RoleGuard'
import { notificationKind } from '@/lib/notifications/kinds'
import { dayGroupLabel, timeWithinDay } from '@/lib/notifications/relative-time'
import {
  useOptionalNotifications,
  type InAppNotification,
} from '@/components/notifications/NotificationsProvider'

type Filter = 'all' | 'unread'
type Page = { items: InAppNotification[]; nextCursor?: string | null }

const PAGE_SIZE = 30

/** Los avisos en grupos por día, en el orden en que llegan (más nuevos primero). */
function groupByDay(items: InAppNotification[], now: Date) {
  const groups: { label: string; items: InAppNotification[] }[] = []
  for (const item of items) {
    const label = dayGroupLabel(item.createdAt, now)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

function NotificationListItem({
  item,
  onOpen,
  onMarkRead,
}: {
  item: InAppNotification
  onOpen: (item: InAppNotification) => void
  onMarkRead: (item: InAppNotification) => void
}) {
  const kind = notificationKind(item.type)
  const unread = !item.readAt
  return (
    <li className={`flex items-start gap-1 ${unread ? 'bg-emerald-50/40' : 'bg-white'}`}>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
      >
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${kind.tone}`}>
          <kind.Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className={`text-sm text-slate-900 ${unread ? 'font-semibold' : 'font-medium'}`}>{item.title}</span>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">{timeWithinDay(item.createdAt)}</span>
          </span>
          <span className="mt-0.5 block text-sm text-slate-600">{item.body}</span>
          <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            {kind.label}
            {unread ? (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
                Sin leer
              </span>
            ) : null}
          </span>
        </span>
      </button>
      {unread ? (
        <button
          type="button"
          onClick={() => onMarkRead(item)}
          title="Marcar como leído"
          aria-label={`Marcar como leído: ${item.title}`}
          className="mr-2 mt-3 shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700"
        >
          <Check className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </li>
  )
}

/**
 * Todos los avisos de la cuenta, agrupados por día. La campana del encabezado muestra los últimos;
 * acá están todos, con filtro de no leídos y "Cargar más". Leer acá también baja el número de la
 * campana, porque las acciones pasan por el mismo estado (`NotificationsProvider`).
 */
export default function NotificationsPage() {
  const notifications = useOptionalNotifications()
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<InAppNotification[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [error, setError] = useState('')

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const params = new URLSearchParams({ take: String(PAGE_SIZE) })
      if (filter === 'unread') params.set('unreadOnly', 'true')
      if (cursor) params.set('before', cursor)
      return api<Page>(`/notifications/in-app?${params.toString()}`)
    },
    [filter],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const page = await fetchPage(null)
      setItems(page.items ?? [])
      setNextCursor(page.nextCursor ?? null)
    } catch (e: unknown) {
      if ((e as { status?: number })?.status === 401) {
        globalThis.location.href = '/login'
        return
      }
      setError('No se pudieron cargar los avisos.')
    } finally {
      setLoading(false)
    }
  }, [fetchPage])

  useEffect(() => {
    void load()
  }, [load])

  // Lo que llega mientras la página está abierta aparece arriba, sin recargar la lista.
  const latest = notifications?.items
  useEffect(() => {
    if (!latest || loading) return
    setItems((current) => {
      const known = new Set(current.map((item) => item.id))
      const newest = current[0]?.createdAt ?? ''
      const arrived = latest.filter(
        (item) => !known.has(item.id) && item.createdAt > newest && (filter === 'all' || !item.readAt),
      )
      return arrived.length > 0 ? [...arrived, ...current] : current
    })
  }, [latest, loading, filter])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(nextCursor)
      setItems((current) => [...current, ...(page.items ?? [])])
      setNextCursor(page.nextCursor ?? null)
    } catch {
      setError('No se pudieron cargar más avisos.')
    } finally {
      setLoadingMore(false)
    }
  }

  function markLocallyRead(id: string | null) {
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => (id === null || item.id === id ? { ...item, readAt: item.readAt ?? now } : item)))
  }

  async function markRead(item: InAppNotification) {
    if (item.readAt) return
    markLocallyRead(item.id)
    if (notifications) await notifications.markRead(item)
    else await api(`/notifications/in-app/${item.id}/read`, { method: 'PATCH' }).catch(() => undefined)
  }

  async function open(item: InAppNotification) {
    markLocallyRead(item.id)
    if (notifications) {
      await notifications.open(item)
      return
    }
    if (!item.readAt) await api(`/notifications/in-app/${item.id}/read`, { method: 'PATCH' }).catch(() => undefined)
    if (item.actionUrl) router.push(item.actionUrl)
  }

  async function markAllRead() {
    setMarkingAll(true)
    try {
      markLocallyRead(null)
      if (notifications) await notifications.markAllRead()
      else await api('/notifications/in-app/read-all', { method: 'POST' })
    } catch {
      setError('No se pudieron marcar los avisos como leídos.')
    } finally {
      setMarkingAll(false)
    }
  }

  const groups = groupByDay(items, new Date())
  const unreadCount = notifications?.unreadCount ?? items.filter((item) => !item.readAt).length

  return (
    <RoleGuard permission="notifications.read">
      <main className="responsive-page max-w-3xl space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
              <Bell className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Avisos</h1>
              <p className="mt-1 text-sm text-slate-500">Licencias, agenda, libreta y alertas de tu cuenta.</p>
            </div>
          </div>
          {unreadCount > 0 && (
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
                    Marcar todo como leído
                  </>
                }
              />
            </button>
          )}
        </header>

        <div role="group" aria-label="Filtrar avisos" className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {(
            [
              { id: 'all', label: 'Todos' },
              { id: 'unread', label: unreadCount > 0 ? `No leídos (${unreadCount})` : 'No leídos' },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filter === option.id ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando avisos…
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 py-16 text-center">
            <Bell className="mb-3 h-10 w-10 text-slate-300" aria-hidden />
            <p className="text-sm font-medium text-slate-700">
              {filter === 'unread' ? 'No tenés avisos sin leer' : 'No hay avisos todavía'}
            </p>
            {filter === 'all' && (
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Acá vas a ver los avisos de licencias, de tu agenda, de la libreta y las alertas de estudiantes.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</h2>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {group.items.map((item) => (
                    <NotificationListItem
                      key={item.id}
                      item={item}
                      onOpen={(it) => void open(it)}
                      onMarkRead={(it) => void markRead(it)}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {nextCursor && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="btn-secondary text-sm"
                >
                  <PendingButtonContent pending={loadingMore} pendingText="Cargando…" idle="Cargar más" />
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
