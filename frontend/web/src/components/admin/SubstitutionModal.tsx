'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '@/lib/api/client'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import { getTodayYmdInUruguay } from '@/lib/forms/datetime-uy'
import DateField from '@/components/forms/DateField'
import type { SubstitutionRow } from '@/lib/substitutions/types'
import { getRoleLabel } from '@/lib/roles/display'

type TeacherOpt = { id: string; name: string; email: string; role: string }

export type SubstitutionModalEvent = {
  id: string
  title: string
  type: string
  status: string
  startDate: string
  startTime?: string
  endTime?: string
  isRecurring?: boolean
  assignedUser?: { id: string; name: string } | null
  assignedUserId?: string | null
  course?: { name: string } | null
  subject?: { name: string } | null
}

type Props = {
  event: SubstitutionModalEvent
  teachers: TeacherOpt[]
  onClose: () => void
  onSaved: () => void
  /** Fecha de la ocurrencia pre-seleccionada (p. ej. al abrir desde el calendario). */
  initialDate?: string
}

export default function SubstitutionModal({ event, teachers, onClose, onSaved, initialDate }: Props) {
  const [portalReady, setPortalReady] = useState(false)
  const [occurrenceDate, setOccurrenceDate] = useState(initialDate || getTodayYmdInUruguay())
  const [substituteUserId, setSubstituteUserId] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [existing, setExisting] = useState<SubstitutionRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setPortalReady(true), [])

  const loadExisting = useCallback(async () => {
    try {
      const q = new URLSearchParams({ eventId: event.id, from: occurrenceDate, to: occurrenceDate })
      const res = await api<{ data: SubstitutionRow[] }>(`/substitutions?${q}`)
      setExisting(res.data[0] ?? null)
    } catch {
      setExisting(null)
    }
  }, [event.id, occurrenceDate])

  useEffect(() => {
    void loadExisting()
  }, [loadExisting])

  const eligibleTeachers = teachers.filter(
    (t) => t.id !== (event.assignedUserId || event.assignedUser?.id) && t.role !== 'ADMIN',
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api('/substitutions', {
        method: 'POST',
        body: JSON.stringify({
          eventId: event.id,
          substituteUserId,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          occurrenceDate,
        }),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(formatValidationErrorFromApi(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!existing || !confirm('¿Eliminar esta suplencia? El titular volverá a figurar como ausencia pendiente si correspondía.')) return
    setLoading(true)
    try {
      await api(`/substitutions/${existing.id}`, { method: 'DELETE' })
      onSaved()
      onClose()
    } catch (err) {
      setError(formatValidationErrorFromApi(err))
    } finally {
      setLoading(false)
    }
  }

  if (!portalReady) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483646] flex items-end justify-center overflow-y-auto bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="substitution-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 id="substitution-modal-title" className="text-lg font-semibold text-slate-900">
            Suplencia de clase
          </h2>
          <p className="mt-1 text-sm text-slate-600">{event.title}</p>
          {event.assignedUser ? (
            <p className="text-xs text-slate-500">Titular: {event.assignedUser.name}</p>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : null}

          {existing ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 px-3 py-3 text-sm text-indigo-900">
              <p className="font-medium">Suplencia ya registrada</p>
              <p className="mt-1">
                {existing.substitute?.name || existing.substitute?.email} · {existing.reason}
              </p>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={loading}
                className="mt-2 text-xs font-semibold text-red-700 hover:underline"
              >
                Eliminar suplencia
              </button>
            </div>
          ) : null}

          <div>
            <label htmlFor="sub-occurrence-date" className="mb-1 block text-xs font-medium text-slate-600">
              Fecha de la clase
            </label>
            <DateField
              id="sub-occurrence-date"
              value={occurrenceDate}
              onChange={setOccurrenceDate}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required
            />
          </div>

          <div>
            <label htmlFor="sub-teacher" className="mb-1 block text-xs font-medium text-slate-600">
              Persona suplente
            </label>
            <select
              id="sub-teacher"
              value={substituteUserId}
              onChange={(e) => setSubstituteUserId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required
              disabled={Boolean(existing)}
            >
              <option value="">Seleccionar…</option>
              {eligibleTeachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.email} ({getRoleLabel(t.role)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sub-reason" className="mb-1 block text-xs font-medium text-slate-600">
              Motivo
            </label>
            <input
              id="sub-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              required
              disabled={Boolean(existing)}
              placeholder="Ej. licencia médica del titular"
            />
          </div>

          <div>
            <label htmlFor="sub-notes" className="mb-1 block text-xs font-medium text-slate-600">
              Notas (opcional)
            </label>
            <textarea
              id="sub-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              disabled={Boolean(existing)}
            />
          </div>

          <div className="flex flex-col justify-end gap-2 border-t border-slate-100 pt-4 sm:flex-row">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cerrar
            </button>
            {!existing ? (
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Guardando…' : 'Registrar suplencia'}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
