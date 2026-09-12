'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'

type Decision = {
  id: string
  decision: string
  createdAt: string
  student: { id: string; firstName: string; lastName: string } | null
  createdBy: { id: string; name: string | null } | null
}

type StudentOption = { studentId: string; firstName: string; lastName: string }

/**
 * Decisiones de la reunión de profesores.
 *
 * `TeacherMeetingRecord` existía con su API desde el principio pero **sin ninguna pantalla**: las
 * decisiones se podían crear por HTTP y nadie podía hacerlo desde la app. Es lo que faltaba para
 * que la reunión sea una reunión y no la vista de grupo en letra grande.
 *
 * Sin estudiante, la decisión es del grupo entero — el pliego pide registrar "cuando corresponda",
 * sin tipificar, así que el texto es libre a propósito.
 */
export default function MeetingDecisions({
  courseOfferingId,
  courseOrientationId,
  periodId,
  students,
}: {
  courseOfferingId: string
  courseOrientationId?: string | null
  periodId: string
  students: readonly StudentOption[]
}) {
  const [rows, setRows] = useState<Decision[]>([])
  const [studentId, setStudentId] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: Decision[] }>(
        `/admin/gradebook/meeting-records?courseOfferingId=${courseOfferingId}&periodId=${periodId}`,
      )
      setRows(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las decisiones')
    } finally {
      setLoading(false)
    }
  }, [courseOfferingId, periodId])

  useEffect(() => {
    void load()
  }, [load])

  async function add() {
    if (text.trim().length < 3) {
      setError('Escribí la decisión.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api('/admin/gradebook/meeting-records', {
        method: 'POST',
        body: JSON.stringify({
          courseOfferingId,
          courseOrientationId: courseOrientationId ?? undefined,
          periodId,
          studentId: studentId || undefined,
          decision: text.trim(),
        }),
      })
      setText('')
      setStudentId('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la decisión')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Decisiones de la reunión</h3>
        <p className="text-xs text-gray-500">
          Quedan registradas con quién las cargó y cuándo. Sin estudiante, la decisión es del grupo.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando decisiones…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no se registró ninguna decisión en este período.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-xs font-medium text-gray-600">
                {row.student ? `${row.student.lastName}, ${row.student.firstName}` : 'Todo el grupo'}
              </p>
              <p className="text-sm text-gray-900">{row.decision}</p>
              <p className="text-[11px] text-gray-500">
                {row.createdBy?.name ?? 'Sin autor'} · {row.createdAt.slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-[220px_1fr_auto]">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Sobre</span>
          <select
            className="select-field w-full"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">Todo el grupo</option>
            {students.map((s) => (
              <option key={s.studentId} value={s.studentId}>
                {s.lastName}, {s.firstName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Decisión</span>
          <input
            className="input-field w-full"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Se cita a la familia; se deriva a APE; continúa con apoyo…"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void add()}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Registrar
          </button>
        </div>
      </div>
    </section>
  )
}
