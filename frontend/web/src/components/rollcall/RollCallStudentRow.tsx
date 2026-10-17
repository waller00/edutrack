'use client'

import { useId, useState } from 'react'
import { Check, Clock3, MessageSquare, MessageSquarePlus, ShieldCheck, UserRound, X } from 'lucide-react'
import {
  getRollCallStatusButtonClass,
  nextStatusOnTap,
  ROLL_CALL_STATUS_LABEL,
  type RollCallStatus,
  type TeacherStatus,
} from '@/lib/rollcall/rollcall-status'
import { fullName, type SheetStudent } from '@/lib/rollcall/rollcall-sheet'

type Props = {
  student: SheetStudent
  status: RollCallStatus | null
  note: string | null
  disabled: boolean
  isNew: boolean
  number?: number
  onStatus: (status: TeacherStatus) => void
  onNote: (note: string) => void
}

const STATUS_ICONS = { PRESENT: Check, ABSENT: X, LATE: Clock3, ABSENT_JUSTIFIED: ShieldCheck }

/** Un solo control de estado, con texto e icono, para pasar lista con el pulgar. */
export default function RollCallStudentRow({ student, status, note, disabled, isNew, number, onStatus, onNote }: Props) {
  const [noteOpen, setNoteOpen] = useState(Boolean(note))
  const noteId = useId()
  const name = fullName(student)
  const label = status ? ROLL_CALL_STATUS_LABEL[status] : 'Sin marcar'
  const next = nextStatusOnTap(status)
  const Icon = status ? STATUS_ICONS[status] : UserRound

  return (
    <li className={`rounded-xl border bg-white p-3 transition-colors sm:px-4 ${
      isNew ? 'border-sky-300 bg-sky-50/40' : status ? 'border-slate-200' : 'border-amber-300 bg-amber-50/30'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {number != null && <span className="shrink-0 text-[10px] font-medium tabular-nums text-slate-400">{String(number).padStart(2, '0')}</span>}
            <p className="min-w-0 text-sm font-semibold leading-snug text-slate-900">{name}</p>
          </div>
          {student.documentId && <p className="mt-1 text-[11px] tabular-nums text-slate-500">{student.documentId}</p>}
          {status === 'ABSENT_JUSTIFIED' && <p className="mt-1 text-xs text-sky-800">Falta justificada por secretaría</p>}
          {isNew && <p className="mt-1 text-xs text-sky-800">No estaba en la hora anterior</p>}
          {(!disabled || note) && (
            <button
              type="button"
              aria-label={`Nota para ${name}`}
              aria-expanded={noteOpen}
              aria-controls={noteId}
              onClick={() => setNoteOpen((open) => !open)}
              className={`mt-1 inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs ${note ? 'font-medium text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {note ? <MessageSquare className="h-3.5 w-3.5" aria-hidden /> : <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />}
              {noteOpen ? 'Ocultar nota' : note ? 'Ver nota' : 'Añadir nota'}
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label} — ${name}${disabled ? '' : `. Cambiar a ${ROLL_CALL_STATUS_LABEL[next].toLowerCase()}`}`}
          title={disabled ? label : `Cambiar a ${ROLL_CALL_STATUS_LABEL[next].toLowerCase()}`}
          onClick={() => onStatus(next)}
          className={`inline-flex min-h-12 w-36 shrink-0 touch-manipulation items-center justify-center gap-2 rounded-xl border px-2 text-xs font-semibold transition-colors active:brightness-95 disabled:cursor-default sm:text-sm ${
            status ? getRollCallStatusButtonClass(status, true) : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span aria-live="polite" aria-atomic="true">{status === 'ABSENT_JUSTIFIED' ? 'Justificado' : label}</span>
        </button>
      </div>
      {noteOpen && (
        <div id={noteId} className="mt-3 border-t border-slate-100 pt-3">
          <label htmlFor={`${noteId}-input`} className="mb-1.5 block text-xs font-medium text-slate-600">Nota para {name}</label>
          <input
            id={`${noteId}-input`}
            className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            maxLength={280}
            disabled={disabled}
            placeholder="Llegó a las 8:15, se retiró antes…"
            value={note ?? ''}
            onChange={(event) => onNote(event.target.value)}
          />
        </div>
      )}
    </li>
  )
}
