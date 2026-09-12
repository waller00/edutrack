'use client'

import { Save, Users } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import type { StatusCounts } from '@/lib/rollcall/rollcall-sheet'

type Props = {
  counts: StatusCounts
  disabled: boolean
  saving: boolean
  canCopyPrevious: boolean
  onAllPresent: () => void
  onCopyPrevious: () => void
  onSave: () => void
}

/** Barra fija inferior: acciones masivas + contadores + guardar, al alcance del pulgar. */
export default function RollCallBulkBar({
  counts,
  disabled,
  saving,
  canCopyPrevious,
  onAllPresent,
  onCopyPrevious,
  onSave,
}: Props) {
  return (
    <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-b-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary text-sm" disabled={disabled} onClick={onAllPresent}>
            <Users className="h-4 w-4" aria-hidden />
            Todos presentes
          </button>
          {canCopyPrevious ? (
            <button type="button" className="btn-secondary text-sm" disabled={disabled} onClick={onCopyPrevious}>
              Copiar hora anterior
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-gray-600" aria-live="polite">
            <span className="font-semibold text-emerald-700">{counts.present}</span> presentes ·{' '}
            <span className="font-semibold text-amber-700">{counts.late}</span> tarde ·{' '}
            <span className="font-semibold text-red-700">{counts.absent + counts.justified}</span> ausentes
            {counts.pending > 0 ? (
              <>
                {' '}
                · <span className="font-semibold text-gray-900">{counts.pending}</span> sin marcar
              </>
            ) : null}
          </p>
          <button type="button" className="btn-primary text-sm" disabled={disabled || saving} onClick={onSave}>
            <PendingButtonContent
              pending={saving}
              pendingText="Guardando…"
              idle={
                <>
                  <Save className="h-4 w-4" aria-hidden />
                  Guardar lista
                </>
              }
            />
          </button>
        </div>
      </div>
    </div>
  )
}
