'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, Loader2, Search } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { formatYmdDisplay, todayYmdUruguay } from '@/lib/libreta/absence-day'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'

export type RangeStudent = {
  id: string
  firstName: string
  lastName: string
  documentId: string | null
  courseName?: string | null
}

export type JustificationRange = {
  id: string
  studentId: string
  fromYmd: string
  toYmd: string
  reason: string
  notes: string | null
  createdAt: string
  revokedAt: string | null
  student?: RangeStudent
}

function fullName(s: RangeStudent): string {
  return `${s.lastName}, ${s.firstName}`
}

/** Buscador de estudiantes de ciclo básico. */
function StudentPicker({ onPick }: { onPick: (student: RangeStudent) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<RangeStudent[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setSearching(true)
      api<{ data: RangeStudent[] }>(`/admin/student-attendance/justification-ranges/students?q=${encodeURIComponent(term)}`)
        .then((res) => {
          if (!cancelled) setResults(res.data)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q])

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Estudiante de ciclo básico</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
          <input
            className="input-field w-full pl-8 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Apellido, nombre o documento"
          />
        </span>
      </label>
      {searching && <p className="text-xs text-gray-500">Buscando…</p>}
      {results.length > 0 && (
        <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded border border-gray-200 bg-white">
          {results.map((student) => (
            <li key={student.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(student)
                  setQ('')
                  setResults([])
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50"
              >
                <span className="font-medium text-gray-900">{fullName(student)}</span>
                <span className="text-xs text-gray-500">
                  {[student.courseName, student.documentId].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Alta de un rango para el estudiante elegido. */
function RangeForm({ student, onSaved }: { student: RangeStudent; onSaved: (message: string) => void }) {
  const today = todayYmdUruguay()
  const [fromYmd, setFromYmd] = useState(today)
  const [toYmd, setToYmd] = useState(today)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalidRange = fromYmd > toYmd
  const canSave = !saving && !invalidRange && reason.trim().length >= 3

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await api<{ justifiedCount: number }>('/admin/student-attendance/justification-ranges', {
        method: 'POST',
        body: JSON.stringify({ studentId: student.id, fromYmd, toYmd, reason, notes: notes.trim() || null }),
      })
      setReason('')
      setNotes('')
      onSaved(
        res.justifiedCount > 0
          ? `Justificación registrada. Se justificaron ${res.justifiedCount} ausencia(s) ya marcadas.`
          : 'Justificación registrada. Las ausencias de esos días entrarán justificadas al pasar lista.',
      )
    } catch (e) {
      setError(formatValidationErrorFromApi(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">Desde</span>
          <input type="date" className="input-field text-sm" value={fromYmd} onChange={(e) => setFromYmd(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">Hasta</span>
          <input type="date" className="input-field text-sm" value={toYmd} onChange={(e) => setToYmd(e.target.value)} />
        </label>
      </div>
      {invalidRange && <p className="text-xs text-red-700">La fecha desde no puede ser posterior a la hasta.</p>}
      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Motivo *</span>
        <input
          className="input-field w-full text-sm"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Certificado médico, viaje familiar, trámite…"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Notas</span>
        <textarea className="input-field w-full text-sm" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex justify-end">
        <button type="button" className="btn-primary text-sm" disabled={!canSave} onClick={() => void submit()}>
          <PendingButtonContent pending={saving} pendingText="Guardando…" idle="Justificar días" />
        </button>
      </div>
    </div>
  )
}

function RangeRow({ range, onRevoke }: { range: JustificationRange; onRevoke: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const sameDay = range.fromYmd === range.toYmd
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-gray-900">
          {sameDay ? formatYmdDisplay(range.fromYmd) : `${formatYmdDisplay(range.fromYmd)} al ${formatYmdDisplay(range.toYmd)}`}
          {range.revokedAt && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">Revocada</span>}
        </p>
        <p className="text-gray-600">{range.reason}</p>
      </div>
      {!range.revokedAt &&
        (confirming ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-gray-600">¿Revocar? Lo ya justificado no cambia.</span>
            <button type="button" className="font-semibold text-red-700 hover:underline" onClick={() => onRevoke(range.id)}>
              Sí, revocar
            </button>
            <button type="button" className="text-gray-600 hover:underline" onClick={() => setConfirming(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={() => setConfirming(true)}>
            Revocar
          </button>
        ))}
    </li>
  )
}

/**
 * Justificación por días completos (ciclo básico). La cargan adscripción o dirección, antes o
 * después de la clase: las ausencias de esos días valen media falta en lugar de una entera.
 */
export default function JustificationRangesPanel() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const [student, setStudent] = useState<RangeStudent | null>(null)
  const [ranges, setRanges] = useState<JustificationRange[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!student) return
    setLoading(true)
    try {
      const path = `/admin/student-attendance/justification-ranges?studentId=${student.id}`
      const res = await api<{ data: JustificationRange[] }>(withSchoolYear(path, schoolYearQuery))
      setRanges(res.data)
    } catch (e) {
      setMsg(formatValidationErrorFromApi(e))
    } finally {
      setLoading(false)
    }
  }, [student, schoolYearQuery])

  useEffect(() => {
    void load()
  }, [load])

  async function revoke(id: string) {
    try {
      await api(`/admin/student-attendance/justification-ranges/${id}/revoke`, { method: 'POST' })
      setMsg('Justificación revocada. Las ausencias ya justificadas no cambian.')
      await load()
    } catch (e) {
      setMsg(formatValidationErrorFromApi(e))
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <header className="flex items-start gap-3">
        <CalendarCheck className="mt-0.5 h-5 w-5 text-emerald-600" aria-hidden />
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Justificar días (ciclo básico)</h2>
          <p className="text-sm text-gray-600">
            Previa o posterior. Las ausencias de esos días valen media falta; una llegada tarde no se justifica.
          </p>
        </div>
      </header>

      {student ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-emerald-50 px-3 py-2 text-sm">
            <span className="font-medium text-emerald-900">
              {fullName(student)}
              {student.courseName ? ` · ${student.courseName}` : ''}
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-emerald-800 hover:underline"
              onClick={() => {
                setStudent(null)
                setRanges([])
                setMsg(null)
              }}
            >
              Cambiar estudiante
            </button>
          </div>

          <RangeForm
            student={student}
            onSaved={(message) => {
              setMsg(message)
              void load()
            }}
          />

          {msg && <p role="status" className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">{msg}</p>}

          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-500">Justificaciones cargadas</h3>
            {loading && (
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Cargando…
              </p>
            )}
            {!loading && ranges.length === 0 && <p className="text-sm text-gray-500">Todavía no hay justificaciones por días.</p>}
            {!loading && ranges.length > 0 && (
              <ul className="divide-y divide-gray-100 rounded border border-gray-200">
                {ranges.map((range) => (
                  <RangeRow key={range.id} range={range} onRevoke={(id) => void revoke(id)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <StudentPicker onPick={setStudent} />
      )}
    </section>
  )
}
