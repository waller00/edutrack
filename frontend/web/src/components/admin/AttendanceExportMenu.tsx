'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'

type Props = {
  pending: boolean
  onAttendance: (format: 'excel' | 'pdf') => Promise<void>
  onPayroll: (format: 'XLSX' | 'CSV') => Promise<void>
}

export default function AttendanceExportMenu({ pending, onAttendance, onPayroll }: Props) {
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

  function select(exportFile: () => Promise<void>) {
    setOpen(false)
    trigger.current?.focus()
    void exportFile()
  }

  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" disabled={pending} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} className="btn-secondary w-full text-sm disabled:cursor-wait disabled:opacity-60 sm:w-auto">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        {pending ? 'Generando archivo…' : 'Exportar'}
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label="Opciones de exportación" onBlur={(event) => { if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false) }} className="absolute right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-2 py-2 text-xs font-semibold text-slate-500">Asistencia del personal</p>
          <button type="button" aria-label="Exportar asistencias a Excel" onClick={() => select(() => onAttendance('excel'))} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" aria-hidden />Excel (.xlsx)
          </button>
          <button type="button" aria-label="Exportar asistencias a PDF" onClick={() => select(() => onAttendance('pdf'))} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50">
            <FileText className="h-4 w-4 text-emerald-600" aria-hidden />PDF (.pdf)
          </button>
          <div className="mt-2 border-t border-slate-100 pt-2">
            <p className="px-2 py-1 text-xs font-semibold text-slate-500">Novedades de sueldos</p>
            <p className="px-2 pb-2 text-xs text-slate-500">Horas, suplencias, faltas y licencias para liquidación.</p>
            <button type="button" aria-label="Exportar novedades a Excel" onClick={() => select(() => onPayroll('XLSX'))} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" aria-hidden />Excel (.xlsx)
            </button>
            <button type="button" aria-label="Exportar novedades a CSV" onClick={() => select(() => onPayroll('CSV'))} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50">
              <FileText className="h-4 w-4 text-emerald-600" aria-hidden />CSV (.csv)
            </button>
            <p className="px-2 pt-1 text-xs text-slate-500">Sin persona ni perfil elegidos, incluye a todos los docentes.</p>
          </div>
          <p className="mt-2 border-t border-slate-100 px-2 pt-2 text-xs text-slate-500">Los archivos respetan los filtros aplicados.</p>
        </div>
      )}
    </div>
  )
}
