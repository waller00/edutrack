'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import type { OnboardingSpot } from '@/lib/navigation/onboarding'
import { placePopover, type Placement } from '@/lib/navigation/tour-placement'

/** Margen del resaltado alrededor del control, para que el anillo no lo tape. */
const RING = 6

/**
 * El control que señala un globo, si está a la vista. El mismo ancla puede estar más de una vez
 * (el menú de escritorio y el del celular, la tabla y su versión en tarjetas): vale el primero que
 * se ve. Uno oculto (`hidden`, `display: none`) no tiene cajas.
 */
export function findTourTarget(target: string): HTMLElement | null {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    if (node.getClientRects().length > 0) return node
  }
  return null
}

/**
 * Qué globos tienen su control en la pantalla, al día con lo que va apareciendo: los datos cargan
 * después que la pantalla, y una pestaña o una planilla nueva traen sus propios controles. Los
 * cambios del propio globo no cuentan (si no, cada reposición dispararía otro recálculo).
 */
function useAvailableTargets(spots: readonly OnboardingSpot[], ignore: RefObject<HTMLElement | null>): string[] {
  const key = spots.map((spot) => spot.target).join('|')
  const [available, setAvailable] = useState<string[]>([])

  useEffect(() => {
    const targets = key ? key.split('|') : []
    let frame = 0
    const check = () => {
      frame = 0
      const next = targets.filter((target) => findTourTarget(target))
      setAvailable((previous) => (previous.join('|') === next.join('|') ? previous : next))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    check()
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => !ignore.current?.contains(mutation.target))) schedule()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tour', 'hidden', 'class', 'style', 'open'],
    })
    window.addEventListener('resize', schedule)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key, ignore])

  return available
}

/**
 * La caja del control, al día con el scroll, el tamaño de la ventana y los cambios del control.
 * `version` cambia cuando cambia lo que hay en pantalla: el control pudo haberse vuelto a crear.
 */
function useTargetRect(target: string | null, version: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    const element = target ? findTourTarget(target) : null
    if (!element) {
      setRect(null)
      return
    }
    let frame = 0
    const measure = () => {
      frame = 0
      setRect(element.getBoundingClientRect())
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    resize?.observe(element)
    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      resize?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [target, version])

  return rect
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Lleva el control a la vista si no lo está. */
function reveal(target: string) {
  const element = findTourTarget(target)
  if (!element) return
  const box = element.getBoundingClientRect()
  if (box.top >= 0 && box.bottom <= window.innerHeight) return
  element.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

/**
 * Los globos del onboarding sobre la pantalla real: resalta un control y, al lado, dice qué hacer
 * ahí. No bloquea nada: el resaltado deja pasar los clics (se puede usar el control señalado) y
 * el globo no es modal. Un control que todavía no está (sin datos, en otra pestaña) se saltea y
 * su globo aparece cuando el control aparece.
 */
export default function OnboardingSpotlight({
  spots,
  onClose,
}: {
  spots: readonly OnboardingSpot[]
  /** «Ocultar globos», `Esc` o «Listo» en el último. */
  onClose: () => void
}) {
  const layer = useRef<HTMLDivElement | null>(null)
  const popover = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const available = useAvailableTargets(spots, layer)
  const [chosen, setChosen] = useState<string | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const focusOnChange = useRef(false)

  const current = chosen && available.includes(chosen) ? chosen : (available[0] ?? null)
  const index = current ? available.indexOf(current) : -1
  const spot = spots.find((candidate) => candidate.target === current) ?? null
  const rect = useTargetRect(current, available.join('|'))

  useEffect(() => {
    if (!current) return
    reveal(current)
    if (focusOnChange.current) {
      focusOnChange.current = false
      popover.current?.focus()
    }
  }, [current])

  useLayoutEffect(() => {
    const box = popover.current
    if (!rect || !box) return
    setPlacement(
      placePopover(
        rect,
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [rect, current])

  const go = useCallback(
    (step: number) => {
      const next = available[index + step]
      if (!next) return
      focusOnChange.current = true
      setChosen(next)
    },
    [available, index],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!spot || !rect || typeof document === 'undefined') return null
  const last = index === available.length - 1
  const docked = placement?.side === 'dock'

  return createPortal(
    <div ref={layer} data-onboarding-spotlight="">
      <div
        aria-hidden
        className="pointer-events-none fixed z-[60] rounded-lg ring-2 ring-emerald-500 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] transition-all duration-200 motion-reduce:transition-none"
        style={{
          top: rect.top - RING,
          left: rect.left - RING,
          width: rect.width + 2 * RING,
          height: rect.height + 2 * RING,
        }}
      />
      <div
        ref={popover}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`fixed z-[61] rounded-xl border border-emerald-200 bg-white p-4 shadow-xl focus:outline-none ${
          docked ? 'inset-x-3 bottom-3' : 'w-80 max-w-[calc(100vw-24px)]'
        }`}
        style={docked ? undefined : { top: placement?.top ?? -9999, left: placement?.left ?? -9999 }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {index + 1} de {available.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Ocultar globos"
            className="-mr-1 -mt-1 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <h2 id={titleId} className="mt-1 text-sm font-semibold text-slate-900">
          {spot.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{spot.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:invisible"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Anterior
          </button>
          {last ? (
            <button type="button" onClick={onClose} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm">
              <Check className="h-4 w-4" aria-hidden />
              Listo
            </button>
          ) : (
            <button type="button" onClick={() => go(1)} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm">
              Siguiente
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
