'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { downloadFile } from '@/lib/api/download'

export type ReportFormat = 'pdf' | 'xlsx'

const OPTIONS: { format: ReportFormat; label: string; detail: string; Icon: typeof FileText }[] = [
  { format: 'pdf', label: 'PDF para imprimir', detail: 'Con el logo y el nombre de la institución.', Icon: FileText },
  { format: 'xlsx', label: 'Excel con los datos', detail: 'Una hoja por tabla, para trabajar los números.', Icon: FileSpreadsheet },
]

/**
 * «Descargar informe»: lo que muestra la pantalla, en PDF o en Excel, con el período, el ciclo y
 * los filtros elegidos. Lo arma el servidor con los mismos números y queda en la auditoría.
 *
 * Un botón que abre un panel (no un menú de opciones del sistema): el error de una descarga se
 * muestra en el mismo panel, sin mover el resto de la pantalla.
 */
export default function ReportDownloadMenu({
  pathFor,
  fallbackName,
  disabled = false,
  note,
  tour,
}: Readonly<{
  /** La ruta de la API para cada formato, con los filtros de la pantalla. */
  pathFor: (format: ReportFormat) => string
  /** Nombre del archivo si el servidor no manda uno. */
  fallbackName: (format: ReportFormat) => string
  disabled?: boolean
  /** Qué trae el informe, en una línea. */
  note?: string
  tour?: string
}>) {
  const panelId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ReportFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const download = async (format: ReportFormat) => {
    setBusy(format)
    setError(null)
    try {
      await downloadFile(pathFor(format), fallbackName(format))
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'No se pudo generar el informe. Probá de nuevo en un momento.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      ref={root}
      // Sólo agrupa: el foco lo tienen el botón y las opciones; acá se escucha el Escape de todos.
      role="presentation"
      className="relative"
      data-tour={tour}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) close()
      }}
    >
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setError(null)
          setOpen((value) => !value)
        }}
        className="btn-secondary inline-flex min-h-10 items-center gap-2 text-sm disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        Descargar informe
        <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Descargar informe"
          className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
        >
          {note && <p className="px-2 pb-1 pt-1 text-xs leading-relaxed text-slate-500">{note}</p>}
          {OPTIONS.map(({ format, label, detail, Icon }) => (
            <button
              key={format}
              type="button"
              disabled={busy !== null}
              onClick={() => void download(format)}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-60"
            >
              {busy === format ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate-500" aria-hidden />
              ) : (
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
              )}
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{busy === format ? 'Generando…' : label}</span>
                <span className="block text-xs text-slate-500">{detail}</span>
              </span>
            </button>
          ))}
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-2 py-2 text-xs text-red-800">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
