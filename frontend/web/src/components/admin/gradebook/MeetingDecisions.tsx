'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'

type Decision = {
  id: string
  decision: string
  createdAt: string
  student: { id: string; firstName: string; lastName: string } | null
  createdBy: { id: string; name: string | null } | null
}

type StudentOption = { studentId: string; firstName: string; lastName: string }

/**
 * La decisión vigente de cada alumno —y la del grupo— es la más reciente: es la que el docente ve
 * como "Juicio Reu." en su cierre. Las anteriores quedan como historia, no se borran.
 */
export function currentDecisionIds(rows: readonly Decision[]): Set<string> {
  const newest = new Map<string, Decision>()
  for (const row of rows) {
    const key = row.student?.id ?? 'grupo'
    const current = newest.get(key)
    if (!current || row.createdAt > current.createdAt) newest.set(key, row)
  }
  return new Set([...newest.values()].map((row) => row.id))
}

export function meetingRecordsPath(courseOfferingId: string, courseOrientationId: string | null | undefined, periodId: string) {
  const params = new URLSearchParams({ courseOfferingId, periodId })
  if (courseOrientationId) params.set('courseOrientationId', courseOrientationId)
  return `/admin/gradebook/meeting-records?${params}`
}

/**
 * Decisiones de la reunión de profesores.
 *
 * Sin estudiante, la decisión es del grupo entero —su orientación, no todo el curso—. El pliego
 * pide registrar "cuando corresponda", sin tipificar, así que el texto es libre a propósito.
 * Registrarlas es de adscripción y dirección (`gradebook.review`); el resto las lee.
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
  const auth = useOptionalAuth()
  const canWrite = hasPermission(auth?.me, 'gradebook.review', 'all')
  const [rows, setRows] = useState<Decision[]>([])
  const [studentId, setStudentId] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: Decision[] }>(meetingRecordsPath(courseOfferingId, courseOrientationId, periodId))
      setRows(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las decisiones')
    } finally {
      setLoading(false)
    }
  }, [courseOfferingId, courseOrientationId, periodId])

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

  const current = currentDecisionIds(rows)

  return (
    <section
      id="decisiones-reunion"
      className="scroll-mt-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Juicio / decisiones de la reunión</h3>
        <p className="text-xs text-gray-600">
          El docente ve en su cierre, como <strong>Juicio Reu.</strong>, la decisión vigente de cada alumno —o la
          del grupo si el alumno no tiene una propia—. Una decisión nueva reemplaza a la anterior sin borrarla.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando decisiones…
        </p>
      )}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-gray-500">Todavía no se registró ninguna decisión en este período.</p>
      )}
      {!loading && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const isCurrent = current.has(row.id)
            return (
              <li
                key={row.id}
                className={`rounded-lg border px-3 py-2 ${isCurrent ? 'border-gray-100 bg-gray-50' : 'border-dashed border-gray-200 bg-white opacity-75'}`}
              >
                <p className="text-xs font-medium text-gray-600">
                  {row.student ? `${row.student.lastName}, ${row.student.firstName}` : 'Todo el grupo'}
                  <span className="ml-2 font-normal text-gray-500">{isCurrent ? '· Vigente' : '· Reemplazada'}</span>
                </p>
                <p className="whitespace-pre-line text-sm text-gray-900">{row.decision}</p>
                <p className="text-[11px] text-gray-500">
                  {row.createdBy?.name ?? 'Sin autor'} · {row.createdAt.slice(0, 10)}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {canWrite ? (
        <div className="grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-[220px_1fr_auto]">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-600">Sobre</span>
            <select className="select-field w-full" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
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
            <textarea
              className="input-field min-h-[64px] w-full"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ej.: Reconocemos logros…; se cita a la familia; continúa con apoyo…"
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
              Guardar juicio
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-gray-100 pt-3 text-xs text-gray-500">
          Las decisiones las registran adscripción y dirección.
        </p>
      )}
    </section>
  )
}
