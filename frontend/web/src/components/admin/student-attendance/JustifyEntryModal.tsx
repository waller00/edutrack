'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '@/lib/api/client'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'

type Props = {
  entryId: string
  studentName: string
  onClose: () => void
  onDone: () => void
}

const TYPES = [
  { value: 'ABSENCE', label: 'Ausencia' },
  { value: 'LATE_ARRIVAL', label: 'Llegada tarde' },
  { value: 'OTHER', label: 'Otro' },
] as const

/**
 * Justifica una falta de estudiante. A diferencia de `AttendanceJustifyModal` (personal),
 * este diálogo sí declara `aria-modal`, atrapa Escape y toma el foco al abrirse.
 */
export default function JustifyEntryModal({ entryId, studentName, onClose, onDone }: Props) {
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('ABSENCE')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  // El liceo no tiene regla automática para la media falta: la decide adscripción caso por caso.
  const [weight, setWeight] = useState<100 | 50>(100)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    reasonRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await api(`/admin/student-attendance/entries/${entryId}/justify`, {
        method: 'POST',
        body: JSON.stringify({
          type,
          reason,
          notes: notes.trim() || null,
          absenceWeightHundredths: weight,
        }),
      })
      onDone()
    } catch (e) {
      setError(formatValidationErrorFromApi(e))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="justify-title">
      <div className="responsive-modal-panel max-w-md space-y-4">
        <div>
          <h2 id="justify-title" className="text-lg font-semibold text-gray-900">
            Justificar falta
          </h2>
          <p className="text-sm text-gray-600">{studentName}</p>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Tipo</span>
          <select className="select-field w-full text-sm" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Motivo *</span>
          <input
            ref={reasonRef}
            className="input-field w-full text-sm"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Certificado médico, trámite, duelo…"
          />
        </label>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Cuánto vale la falta
          </legend>
          <div className="flex gap-4">
            {([100, 50] as const).map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  name="absence-weight"
                  value={value}
                  checked={weight === value}
                  onChange={() => setWeight(value)}
                  className="h-4 w-4"
                />
                {value === 100 ? 'Falta entera' : 'Media falta'}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Notas</span>
          <textarea
            className="input-field w-full text-sm"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={saving || reason.trim().length < 3}
            onClick={() => void submit()}
          >
            <PendingButtonContent pending={saving} pendingText="Guardando…" idle="Registrar justificación" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
