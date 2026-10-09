'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

type Action = {
  label: string
  icon: LucideIcon
  onSelect: () => void
  destructive?: boolean
}

export default function UserActionsMenu({ name, actions }: { name: string; actions: Action[] }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    if (!trigger.current || !panel.current) return
    const rect = trigger.current.getBoundingClientRect()
    const width = panel.current.offsetWidth
    const height = panel.current.offsetHeight
    const below = innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const top = below >= height || below >= above ? rect.bottom + 8 : rect.top - height - 8
    setPosition({
      top: Math.max(8, Math.min(top, innerHeight - height - 8)),
      left: Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)),
    })
  }, [])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    function outside(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    function reposition(event: Event) {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) updatePosition()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, updatePosition])

  return (
    <>
      <button ref={trigger} type="button" aria-label={`Más acciones de ${name}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-400">
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      {open && createPortal(
        <div ref={panel} id={id} role="dialog" aria-label={`Acciones de ${name}`} style={position} onBlur={(event) => {
          if (event.relatedTarget && !panel.current?.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false)
        }} className="fixed z-50 max-h-[calc(100dvh-1rem)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="break-words border-b border-slate-100 px-2 pb-2 pt-1 text-xs text-slate-500">{name}</p>
          {actions.map(({ label, icon: Icon, onSelect, destructive }) => (
            <button key={label} type="button" onClick={() => {
              setOpen(false)
              trigger.current?.focus()
              onSelect()
            }} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 ${destructive ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-emerald-50'}`}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />{label}
            </button>
          ))}
        </div>, document.body,
      )}
    </>
  )
}
