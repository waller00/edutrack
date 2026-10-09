'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { notificationKind } from '@/lib/notifications/kinds'
import { useNotifications } from './NotificationsProvider'

/** Cuánto queda a la vista el cartelito (con el mouse encima no se va). */
export const TOAST_MS = 6_000

/**
 * Cartelito que aparece cuando llega un aviso mientras se usa la app. Con uno solo muestra de qué
 * se trata y al tocarlo lo abre; con varios los cuenta y abre el panel de la campana.
 */
export default function NotificationToast() {
  const { toast, dismissToast, open, setPanelOpen } = useNotifications()
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!toast || hovered) return
    const timer = setTimeout(dismissToast, TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast, hovered, dismissToast])

  if (!toast) return null
  const single = toast.length === 1 ? toast[0] : null
  const first = toast[0]
  const kind = notificationKind(first.type)

  function activate() {
    if (single) void open(single)
    else setPanelOpen(true)
    dismissToast()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // En el celular queda por encima de las barras de acción de abajo (la de "Guardar lista").
      className="fixed inset-x-3 bottom-24 z-50 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-96"
    >
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${kind.tone}`}>
          <kind.Icon className="h-4 w-4" aria-hidden />
        </span>
        <button type="button" onClick={activate} className="min-w-0 flex-1 text-left">
          <span className="block text-xs font-semibold text-emerald-700">
            {single ? 'Nuevo aviso' : `${toast.length} avisos nuevos`}
          </span>
          <span className="block truncate text-sm font-medium text-slate-900">{first.title}</span>
          {single ? <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600">{single.body}</span> : null}
        </button>
        <button
          type="button"
          onClick={dismissToast}
          aria-label="Cerrar aviso"
          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
