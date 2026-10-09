'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Download, Loader2, Upload } from 'lucide-react'

type Props = {
  pending: boolean
  onImport: () => void
  onDownloadTemplate: () => void
}

export default function EventsImportMenu({ pending, onImport, onDownloadTemplate }: Props) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  function select(action: () => void) {
    setOpen(false)
    trigger.current?.focus()
    action()
  }

  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" disabled={pending} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} className="btn-secondary w-full text-sm disabled:cursor-wait disabled:opacity-60 sm:w-auto">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
        {pending ? 'Importando…' : 'Importar'}
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label="Opciones de importación" onBlur={(event) => { if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false) }} className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-2 py-2 text-xs text-slate-500">Cargá varias actividades desde un archivo CSV.</p>
          <button type="button" onClick={() => select(onImport)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50">
            <Upload className="h-4 w-4 text-emerald-600" aria-hidden />Importar CSV
          </button>
          <button type="button" onClick={() => select(onDownloadTemplate)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50">
            <Download className="h-4 w-4 text-emerald-600" aria-hidden />Descargar formato
          </button>
        </div>
      )}
    </div>
  )
}
