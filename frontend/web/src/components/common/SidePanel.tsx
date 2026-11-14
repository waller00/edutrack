'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]'

/** Tab y Shift+Tab dan la vuelta dentro del panel: el foco no se escapa a la página de atrás. */
function keepTabInside(event: KeyboardEvent, panel: HTMLElement | null) {
  const elements = panel?.querySelectorAll<HTMLElement>(FOCUSABLE)
  if (!elements?.length) return
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/**
 * Panel al costado de la pantalla (mensajes, el alumno en la reunión). Es un diálogo: atrapa el
 * foco, se cierra con Escape o tocando afuera, bloquea el scroll de la página y, al cerrarse,
 * devuelve el foco a quien lo abrió.
 */
export default function SidePanel({
  open,
  onClose,
  labelledBy,
  initialFocusRef,
  widthClass = 'max-w-md',
  children,
}: Readonly<{
  open: boolean
  onClose: () => void
  /** Id del título del panel. */
  labelledBy: string
  /** Dónde arranca el foco; si no, en el primer control. */
  initialFocusRef?: RefObject<HTMLElement | null>
  widthClass?: string
  children: ReactNode
}>) {
  const [portalReady, setPortalReady] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  // El cierre se lee al apretar la tecla: un `onClose` nuevo en cada render no reinicia el foco.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => setPortalReady(true), [])

  useEffect(() => {
    if (!open || !portalReady) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const initial = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    initial?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
      if (event.key === 'Tab') keepTabInside(event, panelRef.current)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [open, portalReady, initialFocusRef])

  if (!open || !portalReady) return null

  return createPortal(
    <div
      // El fondo oscuro: un clic afuera cierra, y con teclado se cierra con Escape (arriba).
      role="presentation"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
      onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`flex h-[100dvh] w-full ${widthClass} flex-col bg-white shadow-2xl`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
