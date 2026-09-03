'use client'

import { useState } from 'react'
import { MessageSquare, MessageSquarePlus } from 'lucide-react'
import {
  getRollCallStatusButtonClass,
  ROLL_CALL_STATUS_LABEL,
  ROLL_CALL_STATUS_SHORT,
  TEACHER_STATUSES,
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
  onStatus: (status: TeacherStatus) => void
  onNote: (note: string) => void
}

/**
 * Fila de un alumno en la planilla. Los botones son de 44 px para poder marcarlos con el
 * pulgar sin apuntar: el docente pasa lista de pie, en el aula y con el celular en una mano.
 */
export default function RollCallStudentRow({ student, status, note, disabled, isNew, onStatus, onNote }: Props) {
  const [noteOpen, setNoteOpen] = useState(Boolean(note))

  return (
    <li
      className={`rounded-lg border p-3 ${
        isNew ? 'border-sky-300 bg-sky-50/50' : status ? 'border-gray-200' : 'border-amber-200 bg-amber-50/40'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{fullName(student)}</p>
          <p className="truncate text-xs text-gray-500">
            {student.documentId ?? 'Sin documento'}
            {status === 'ABSENT_JUSTIFIED' ? ' · Falta justificada por secretaría' : ''}
            {isNew ? ' · No estaba en la hora anterior' : ''}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {TEACHER_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              aria-pressed={status === option}
              aria-label={`${ROLL_CALL_STATUS_LABEL[option]} — ${fullName(student)}`}
              title={ROLL_CALL_STATUS_LABEL[option]}
              onClick={() => onStatus(option)}
              className={`min-h-11 min-w-11 rounded-lg border text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${getRollCallStatusButtonClass(
                option,
                status === option,
              )}`}
            >
              {ROLL_CALL_STATUS_SHORT[option]}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Nota para ${fullName(student)}`}
            aria-expanded={noteOpen}
            onClick={() => setNoteOpen((v) => !v)}
            className="min-h-11 min-w-11 rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {note ? (
              <MessageSquare className="mx-auto h-4 w-4 text-emerald-600" aria-hidden />
            ) : (
              <MessageSquarePlus className="mx-auto h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {noteOpen ? (
        <input
          className="input-field mt-3 w-full text-sm"
          maxLength={280}
          disabled={disabled}
          placeholder="Nota opcional (llegó 8:15, se retiró con el padre…)"
          value={note ?? ''}
          onChange={(e) => onNote(e.target.value)}
        />
      ) : null}
    </li>
  )
}
