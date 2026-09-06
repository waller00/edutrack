'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import {
  buildDraft,
  countGraded,
  hasUnsavedChanges,
  invalidCells,
  mergeServerDraft,
  setInput,
  toggleAbsent,
  toSavePayload,
  type SheetDraft,
} from '@/lib/gradebook/sheet'
import { studentFullName } from '@/lib/gradebook/labels'
import type { RosterStudent } from '@/lib/gradebook/types'

type Scale = {
  id: string
  name: string
  kind: 'NUMERIC' | 'ORDINAL'
  decimals: number
  minValueHundredths: number | null
  maxValueHundredths: number | null
}

type SheetResponse = {
  assessment: { id: string; title: string; date: string; gradingScale: Scale }
  permissions: { canEdit: boolean; blockedReason: string | null; editableUntil: string; outsideWindow: boolean }
  students: RosterStudent[]
  grades: Array<{ studentId: string; valueHundredths: number | null; isAbsent: boolean; comment: string | null }>
}

const BLOCK_MESSAGES: Record<string, string> = {
  NOT_ASSIGNED: 'No sos docente de esta libreta.',
  WINDOW_EXPIRED: 'Venció el plazo para editar. Pedí la corrección a administración.',
  PERIOD_CLOSED: 'El período está cerrado.',
  ARCHIVED: 'El ciclo lectivo está cerrado: sólo lectura.',
}

/**
 * Planilla de carga grupal (RF-043, RNF 7.3).
 *
 * Optimizada para recorrerla con el teclado: Enter y las flechas bajan a la celda siguiente sin
 * tocar el mouse, que es como se carga una lista de treinta alumnos.
 */
export default function GradeSheet({
  gradeBookId,
  assessmentId,
}: {
  gradeBookId: string
  assessmentId: string
}) {
  const [data, setData] = useState<SheetResponse | null>(null)
  const [draft, setDraft] = useState<SheetDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])
  const draftRef = useRef<SheetDraft | null>(null)
  draftRef.current = draft

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<SheetResponse>(`/gradebook/${gradeBookId}/assessments/${assessmentId}/grades`)
      setData(res)
      const server = buildDraft(res.students, res.grades, res.assessment.gradingScale.decimals)
      // No se pisa lo que el docente venía cargando si recarga con cambios sin guardar.
      setDraft(mergeServerDraft(server, draftRef.current))
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo cargar la planilla' })
    } finally {
      setLoading(false)
    }
  }, [gradeBookId, assessmentId])

  useEffect(() => {
    void load()
  }, [load])

  // Advertencia ante cambios no guardados (RNF 7.3).
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (draftRef.current && hasUnsavedChanges(draftRef.current)) event.preventDefault()
    }
    globalThis.addEventListener('beforeunload', onBeforeUnload)
    return () => globalThis.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  async function save() {
    if (!draft) return
    const invalid = invalidCells(draft)
    if (invalid.length > 0) {
      setMessage({ kind: 'error', text: `Hay ${invalid.length} calificación(es) con formato inválido.` })
      return
    }
    const entries = toSavePayload(draft)
    if (entries.length === 0) {
      setMessage({ kind: 'ok', text: 'No hay cambios para guardar.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const res = await api<{ data: { created: number; updated: number; unchanged: number } }>(
        `/gradebook/${gradeBookId}/assessments/${assessmentId}/grades`,
        { method: 'PUT', body: JSON.stringify({ entries }) },
      )
      setMessage({
        kind: 'ok',
        text: `Guardado: ${res.data.created} nueva(s), ${res.data.updated} modificada(s).`,
      })
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo guardar' })
    } finally {
      setSaving(false)
    }
  }

  /** Enter y flechas recorren la columna: cargar treinta notas no debería pedir el mouse. */
  function onCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    const step = event.key === 'Enter' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    inputsRef.current[index + step]?.focus()
    inputsRef.current[index + step]?.select()
  }

  if (loading && !data) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando planilla…
      </p>
    )
  }

  if (!data || !draft) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {message?.text ?? 'No se pudo cargar la planilla'}
      </p>
    )
  }

  const scale = data.assessment.gradingScale
  const readOnly = !data.permissions.canEdit
  const counts = countGraded(draft)
  const range = `${formatHundredths(scale.minValueHundredths, scale.decimals)}–${formatHundredths(scale.maxValueHundredths, scale.decimals)}`

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{data.assessment.title}</h2>
          <p className="text-xs text-gray-500">
            {data.assessment.date} · escala {scale.name} ({range})
          </p>
        </div>
        <p className="text-xs text-gray-600">
          {counts.graded} calificados · {counts.absent} ausentes · {counts.pending} pendientes
        </p>
      </header>

      {readOnly && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {BLOCK_MESSAGES[data.permissions.blockedReason ?? ''] ?? 'La planilla es de sólo lectura.'}
        </p>
      )}

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}
        >
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[520px]">
          <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Estudiante</th>
              <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Calificación</th>
              <th scope="col" className="w-24 px-3 py-2 text-left font-medium">Ausente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.students.map((student, index) => {
              const cell = draft.cells[student.studentId]
              return (
                <tr key={student.studentId}>
                  <td className="px-3 py-1.5 text-sm text-gray-900">
                    <span className="mr-2 text-xs text-gray-400">{index + 1}</span>
                    {studentFullName(student)}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      ref={(el) => {
                        inputsRef.current[index] = el
                      }}
                      value={cell.input}
                      disabled={readOnly || cell.isAbsent}
                      inputMode="decimal"
                      aria-label={`Calificación de ${studentFullName(student)}`}
                      onChange={(e) => setDraft(setInput(draft, student.studentId, e.target.value))}
                      onKeyDown={(e) => onCellKeyDown(e, index)}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={cell.isAbsent}
                        disabled={readOnly}
                        aria-label={`Marcar ausente a ${studentFullName(student)}`}
                        onChange={() => setDraft(toggleAbsent(draft, student.studentId))}
                      />
                      Ausente
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !hasUnsavedChanges(draft)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Guardar
          </button>
          {hasUnsavedChanges(draft) && (
            <span className="text-xs text-amber-700">Tenés cambios sin guardar.</span>
          )}
        </div>
      )}
    </div>
  )
}
