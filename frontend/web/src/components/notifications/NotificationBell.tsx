'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, CheckCheck, Loader2, Settings2 } from 'lucide-react'
import { notificationKind } from '@/lib/notifications/kinds'
import { relativeTime } from '@/lib/notifications/relative-time'
import { useNotifications, type InAppNotification } from './NotificationsProvider'

const PANEL_ID = 'notifications-panel'

export function NotificationRow({
  item,
  onOpen,
}: {
  item: InAppNotification
  onOpen: (item: InAppNotification) => void
}) {
  const kind = notificationKind(item.type)
  const unread = !item.readAt
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none ${
        unread ? 'bg-emerald-50/40' : ''
      }`}
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${kind.tone}`}>
        <kind.Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm text-slate-900 ${unread ? 'font-semibold' : 'font-medium'}`}>{item.title}</span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">{item.body}</span>
        <span className="mt-1 block text-[11px] text-slate-500">
          {kind.label} · {relativeTime(item.createdAt)}
        </span>
      </span>
      {unread ? (
        <span className="mt-1.5 flex shrink-0 items-center">
          <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden />
          <span className="sr-only">Sin leer</span>
        </span>
      ) : null}
    </button>
  )
}

/**
 * La campana del encabezado: muestra cuántos avisos hay sin leer y, al tocarla, un panel con los
 * últimos. Tocar un aviso lo marca leído y lleva a lo que avisa, sin recargar la página.
 */
export default function NotificationBell() {
  const { unreadCount, items, loaded, panelOpen, setPanelOpen, refresh, open, markAllRead } = useNotifications()
  const pathname = usePathname()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Al navegar se cierra: el panel no tiene que quedar flotando sobre otra pantalla.
  useEffect(() => {
    setPanelOpen(false)
  }, [pathname, setPanelOpen])

  useEffect(() => {
    if (!panelOpen) return
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setPanelOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setPanelOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [panelOpen, setPanelOpen])

  function toggle() {
    const next = !panelOpen
    setPanelOpen(next)
    if (next) void refresh()
  }

  const label = unreadCount > 0 ? `Avisos, ${unreadCount} sin leer` : 'Avisos'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={panelOpen}
        aria-controls={PANEL_ID}
        title="Avisos"
        className={`relative rounded-lg p-2 transition-colors hover:bg-emerald-50 hover:text-emerald-700 ${
          panelOpen ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600'
        }`}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <div
          ref={panelRef}
          id={PANEL_ID}
          role="dialog"
          aria-label="Avisos"
          className="fixed inset-x-2 top-16 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Avisos</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                Marcar todo como leído
              </button>
            )}
          </div>

          <div className="max-h-[min(28rem,65vh)] overflow-y-auto">
            {!loaded ? (
              <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Cargando avisos…
              </p>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <Bell className="h-8 w-8 text-slate-300" aria-hidden />
                <p className="text-sm font-medium text-slate-700">No tenés avisos</p>
                <p className="text-xs text-slate-500">Acá aparecen los de licencias, agenda, libreta y alertas.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => (
                  <li key={item.id}>
                    <NotificationRow item={item} onOpen={(it) => void open(it)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs">
            <Link href="/notifications" className="font-semibold text-emerald-700 hover:underline">
              Ver todos los avisos
            </Link>
            <Link
              href="/profile?section=notifications"
              className="inline-flex items-center gap-1 text-slate-600 hover:text-emerald-700"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              Configurar avisos
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
