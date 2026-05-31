'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { api } from '@/lib/api/client'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'

type Props = {
  attendanceId: string
  teacherLabel: string
  onClose: () => void
  onSaved: () => void
}

export default function AttendanceJustifyModal({ attendanceId, teacherLabel, onClose, onSaved }: Props) {
  const [portalReady, setPortalReady] = useState(false)
  const [reason, setReason] = useState('')
  const [type, setType] = useState<'ABSENCE' | 'LATE_ARRIVAL' | 'EARLY_EXIT' | 'OTHER'>('OTHER')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setPortalReady(true), [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api(`/attendance/${attendanceId}/justify`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim(), type, notes: notes.trim() || undefined }),
      })
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
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-black/60 p-4" role="dialog">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Justificar asistencia</h2>
        <p className="mt-1 text-sm text-slate-600">{teacherLabel}</p>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Tipo</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="ABSENCE">Ausencia</option>
              <option value="LATE_ARRIVAL">Llegada tarde</option>
              <option value="EARLY_EXIT">Salida anticipada</option>
              <option value="OTHER">Otro</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Motivo</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Guardando…' : 'Registrar justificación'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
