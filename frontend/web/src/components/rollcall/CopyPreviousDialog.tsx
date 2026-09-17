'use client'

import { useEffect, useRef } from 'react'
import { AlertTriangle, Copy } from 'lucide-react'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { ROLL_CALL_STATUS_LABEL, type RollCallStatus } from '@/lib/rollcall/rollcall-status'

export type PreviousResponse = {
  available: boolean
  reason: 'DISABLED' | 'NO_COHORT' | 'NO_PREVIOUS' | null
  sourceSession: { id: string; subject: string | null; startAt: string; endAt: string; takenBy: string | null } | null
  suggestions: { studentId: string; status: RollCallStatus }[]
  newStudentIds: string[]
}

type Props = {
  data: PreviousResponse
  newStudentNames: string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmación de "copiar la hora anterior".
 *
 * Nombra explícitamente a los alumnos que NO estaban en la hora anterior: son justamente el
 * caso que el docente tiene que decidir a mano (alta nueva o cambio de grupo), y si el
 * diálogo no los menciona quedan sin marcar sin que nadie lo note.
 */
export default function CopyPreviousDialog({ data, newStudentNames, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const counts = data.suggestions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="copy-previous-title">
      <div className="responsive-modal-panel max-w-lg space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
            <Copy className="h-5 w-5 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="copy-previous-title" className="text-lg font-semibold text-gray-900">
              Copiar la hora anterior
            </h2>
            {data.sourceSession ? (
              <p className="text-sm text-gray-600">
                {data.sourceSession.subject ?? 'Clase anterior'} ·{' '}
                {formatTimeInUruguay(data.sourceSession.startAt)}–{formatTimeInUruguay(data.sourceSession.endAt)}
                {data.sourceSession.takenBy ? ` · tomada por ${data.sourceSession.takenBy}` : ''}
              </p>
            ) : null}
          </div>
        </div>

        <ul className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          {Object.entries(counts).map(([status, count]) => (
            <li key={status}>
              <span className="font-semibold text-gray-900">{count}</span>{' '}
              {ROLL_CALL_STATUS_LABEL[status as RollCallStatus].toLowerCase()}
            </li>
          ))}
        </ul>

        {newStudentNames.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              {newStudentNames.length === 1
                ? '1 estudiante no estaba en la hora anterior y queda sin marcar: '
                : `${newStudentNames.length} estudiantes no estaban en la hora anterior y quedan sin marcar: `}
              <span className="font-medium">{newStudentNames.join(', ')}</span>.
            </p>
          </div>
        ) : null}

        <p className="text-xs text-gray-500">
          Es una sugerencia: podés cambiar cualquier estado antes de guardar.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onCancel}>
            Cancelar
          </button>
          <button ref={confirmRef} type="button" className="btn-primary text-sm" onClick={onConfirm}>
            Aplicar sugerencia
          </button>
        </div>
      </div>
    </div>
  )
}
