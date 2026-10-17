'use client'

import { CheckCheck, Save } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import type { StatusCounts } from '@/lib/rollcall/rollcall-sheet'

type Props = {
  counts: StatusCounts
  disabled: boolean
  saving: boolean
  taken: boolean
  hasChanges: boolean
  onSave: () => void
}

/** Resumen y guardado al alcance del pulgar, con espacio para el área segura del celular. */
export default function RollCallBulkBar({ counts, disabled, saving, taken, hasChanges, onSave }: Props) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-6px_20px_-12px_rgba(15,23,42,0.3)] backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
      <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500" aria-live="polite" aria-atomic="true">
        <span><strong className="tabular-nums text-emerald-700">{counts.present}</strong> presentes</span>
        <span><strong className="tabular-nums text-red-700">{counts.absent + counts.justified}</strong> ausentes</span>
        <span><strong className="tabular-nums text-amber-700">{counts.late}</strong> tarde</span>
        {counts.pending > 0 && <span className="font-medium text-amber-800">{counts.pending} sin marcar</span>}
      </p>
      <div className="flex items-center justify-between gap-3">
        <p role="status" className={`min-w-0 text-xs ${taken && !hasChanges ? 'text-emerald-700' : 'text-slate-500'}`}>
          {saving ? 'Guardando la lista…' : taken && !hasChanges ? (
            <span className="inline-flex items-center gap-1.5"><CheckCheck className="h-4 w-4 shrink-0" aria-hidden />Lista guardada</span>
          ) : taken ? 'Cambios sin guardar' : 'Lista sin guardar'}
        </p>
        <button
          type="button"
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || saving || (taken && !hasChanges)}
          onClick={onSave}
        >
          <PendingButtonContent pending={saving} pendingText="Guardando…" idle={<><Save className="h-4 w-4" aria-hidden />{taken ? 'Guardar cambios' : 'Guardar lista'}</>} />
        </button>
      </div>
    </div>
  )
}
