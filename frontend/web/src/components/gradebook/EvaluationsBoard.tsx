'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatHundredths, parseToHundredths } from '@/lib/academic-config/grade-value'
import {
  ACTIVITY_CATEGORY_LABEL,
  activityCategory,
  averageHundredths,
  type ActivityCategory,
} from '@/lib/gradebook/activity-category'
import { gradeBookTitle, studentFullName } from '@/lib/gradebook/labels'
import type { GradeBookDetail, RosterStudent } from '@/lib/gradebook/types'
import MoodleImportPanel from './MoodleImportPanel'
import AssessmentsPanel from './AssessmentsPanel'

type Period = { id: string; code: string; name: string }
type Scale = { id: string; name: string; kind: 'NUMERIC' | 'ORDINAL'; decimals: number }
type ActivityType = { id: string; code: string; name: string; scope: 'GLOBAL' | 'TEACHER' }
type Options = { periods: Period[]; scales: Scale[]; activityTypes: ActivityType[] }

type BoardAssessment = {
  id: string
  periodId: string
  period: Period | null
  date: string
  title: string
  activityType: { id: string; code: string; name: string } | null
  gradingScale: { id: string; name: string; kind: string; decimals: number } | null
}

type BoardGrade = {
  assessmentId: string
  studentId: string
  valueHundredths: number | null
  isAbsent: boolean
  comment: string | null
  gradedAt: string
  gradedByName: string | null
}

type BoardResponse = { assessments: BoardAssessment[]; grades: BoardGrade[] }

type StudentGradeRow = BoardGrade & {
  assessment: BoardAssessment
  category: ActivityCategory
}

function periodSummary(
  rows: readonly StudentGradeRow[],
  periodId: string,
): Record<ActivityCategory | 'result', number | null> {
  const inPeriod = rows.filter((r) => r.assessment.periodId === periodId && !r.isAbsent)
  const byCat = (cat: ActivityCategory) =>
    averageHundredths(inPeriod.filter((r) => r.category === cat).map((r) => r.valueHundredths))
  return {
    oral: byCat('oral'),
    written: byCat('written'),
    other: byCat('other'),
    result: averageHundredths(inPeriod.map((r) => r.valueHundredths)),
  }
}

function PeriodBlock({
  period,
  summary,
  decimals,
}: {
  period: Period
  summary: Record<ActivityCategory | 'result', number | null>
  decimals: number
}) {
  const cells: Array<{ key: string; label: string; value: number | null; highlight?: boolean }> = [
    { key: 'oral', label: ACTIVITY_CATEGORY_LABEL.oral, value: summary.oral },
    { key: 'written', label: ACTIVITY_CATEGORY_LABEL.written, value: summary.written },
    { key: 'other', label: ACTIVITY_CATEGORY_LABEL.other, value: summary.other },
    { key: 'result', label: 'R', value: summary.result, highlight: true },
  ]
  return (
    <div className="min-w-[9.5rem] overflow-hidden rounded border border-amber-200 bg-white text-xs">
      <p className="bg-amber-100 px-2 py-1 text-center font-semibold text-amber-950">{period.name}</p>
      <div className="grid grid-cols-4 divide-x divide-amber-100 border-t border-amber-200">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className={`px-1 py-1 text-center ${cell.highlight ? 'bg-amber-50' : ''}`}
            title={cell.highlight ? 'Resultado del período (promedio de las notas del período)' : undefined}
          >
            <p className={`font-medium ${cell.highlight ? 'font-bold text-amber-900' : 'text-slate-600'}`}>
              {cell.label}
            </p>
            <p className={`tabular-nums ${cell.highlight ? 'bg-amber-100 font-semibold text-amber-950' : 'text-slate-900'}`}>
              {formatHundredths(cell.value, decimals)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function AddGradeForm({
  gradeBookId,
  student,
  courseLabel,
  options,
  onCancel,
  onSaved,
}: {
  gradeBookId: string
  student: RosterStudent
  courseLabel: string
  options: Options
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [activityTypeId, setActivityTypeId] = useState(options.activityTypes[0]?.id ?? '')
  const [periodId, setPeriodId] = useState(options.periods[0]?.id ?? '')
  const [gradingScaleId, setGradingScaleId] = useState(options.scales[0]?.id ?? '')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [gradeInput, setGradeInput] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const scale = options.scales.find((s) => s.id === gradingScaleId)
  const activity = options.activityTypes.find((t) => t.id === activityTypeId)
  const canSubmit = Boolean(activityTypeId && periodId && gradingScaleId && date) && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const valueHundredths = parseToHundredths(gradeInput)
    if (gradeInput.trim() && valueHundredths == null) {
      setError('La calificación no es un número válido.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const title = comment.trim() || `${activity?.name ?? 'Evaluación'} — ${date}`
      const created = await api<{ data: { id: string } }>(`/gradebook/${gradeBookId}/assessments`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          date,
          periodId,
          gradingScaleId,
          ...(activityTypeId ? { activityTypeId } : {}),
        }),
      })
      await api(`/gradebook/${gradeBookId}/assessments/${created.data.id}/grades`, {
        method: 'PUT',
        body: JSON.stringify({
          entries: [
            {
              studentId: student.studentId,
              valueHundredths,
              isAbsent: false,
              comment: comment.trim() || null,
            },
          ],
        }),
      })
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-teal-200 bg-teal-50/40 p-4"
      onSubmit={(e) => void handleSubmit(e)}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-teal-800">
            Agregar nueva calificación
          </h3>
          <p className="text-xs text-teal-700/80">{courseLabel}</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded p-1 text-gray-500 hover:bg-white" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </header>

      <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-gray-600">Alumno</dt>
        <dd className="font-medium text-gray-900">{studentFullName(student)}</dd>
      </dl>

      <label className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
        <span className="text-gray-600"><span className="text-red-600">*</span> Calificar</span>
        <select
          required
          value={activityTypeId}
          onChange={(e) => setActivityTypeId(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5"
        >
          {options.activityTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
        <span className="text-gray-600"><span className="text-red-600">*</span> Período</span>
        <select
          required
          value={periodId}
          onChange={(e) => setPeriodId(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5"
        >
          {options.periods.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
        <span className="text-gray-600"><span className="text-red-600">*</span> Fecha</span>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5"
        />
      </label>

      <label className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
        <span className="text-gray-600">Escala</span>
        <select
          value={gradingScaleId}
          onChange={(e) => setGradingScaleId(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1.5"
        >
          {options.scales.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr] sm:items-center">
        <span className="text-gray-600">Calificación</span>
        <input
          value={gradeInput}
          onChange={(e) => setGradeInput(e.target.value)}
          placeholder={scale?.kind === 'NUMERIC' ? 'Ej. 8 o 7,5' : 'Valor numérico'}
          className="max-w-[8rem] rounded border border-gray-300 px-2 py-1.5"
        />
      </label>

      <label className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
        <span className="text-gray-600">Comentario</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          className="rounded border border-gray-300 px-2 py-1.5"
          placeholder="Opcional. Si lo completás, se usa como título de la evaluación."
        />
      </label>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="text-sm font-medium text-red-600 hover:underline">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

function EditGradeForm({
  gradeBookId,
  student,
  row,
  options,
  onCancel,
  onSaved,
}: {
  gradeBookId: string
  student: RosterStudent
  row: StudentGradeRow
  options: Options
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [activityTypeId, setActivityTypeId] = useState(row.assessment.activityType?.id ?? options.activityTypes[0]?.id ?? '')
  const [periodId, setPeriodId] = useState(row.assessment.periodId)
  const [gradingScaleId, setGradingScaleId] = useState(row.assessment.gradingScale?.id ?? options.scales[0]?.id ?? '')
  const [date, setDate] = useState(row.assessment.date)
  const [gradeInput, setGradeInput] = useState(
    row.valueHundredths == null ? '' : String(row.valueHundredths / 100),
  )
  const [comment, setComment] = useState(row.comment || row.assessment.title)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSubmit = Boolean(periodId && gradingScaleId && date) && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const valueHundredths = parseToHundredths(gradeInput)
    if (gradeInput.trim() && valueHundredths == null) {
      setError('La calificación no es un número válido.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api(`/gradebook/${gradeBookId}/assessments/${row.assessmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: comment.trim() || row.assessment.title,
          date,
          periodId,
          gradingScaleId,
          activityTypeId: activityTypeId || null,
        }),
      })
      await api(`/gradebook/${gradeBookId}/assessments/${row.assessmentId}/grades`, {
        method: 'PUT',
        body: JSON.stringify({
          entries: [
            {
              studentId: student.studentId,
              valueHundredths,
              isAbsent: false,
              comment: comment.trim() || null,
            },
          ],
        }),
      })
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3" onSubmit={(e) => void handleSubmit(e)}>
      <h4 className="text-sm font-semibold text-sky-900">Editar calificación — {studentFullName(student)}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Tipo</span>
          <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5">
            {options.activityTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Período</span>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5">
            {options.periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Fecha</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Calificación</span>
          <input value={gradeInput} onChange={(e) => setGradeInput(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs text-gray-600">Comentario</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5" />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="text-sm text-red-600 hover:underline">Cancelar</button>
        <button type="submit" disabled={!canSubmit} className="rounded bg-sky-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  )
}

function StudentDetailPanel({
  gradeBookId,
  student,
  rows,
  decimals,
  canGrade,
  options,
  onSaved,
}: {
  gradeBookId: string
  student: RosterStudent
  rows: StudentGradeRow[]
  decimals: number
  canGrade: boolean
  options: Options | null
  onSaved: () => Promise<void>
}) {
  const [typeDraft, setTypeDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [typeApplied, setTypeApplied] = useState('')
  const [commentApplied, setCommentApplied] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const typeOptions = useMemo(() => {
    const names = new Set<string>()
    for (const row of rows) {
      const name = row.assessment.activityType?.name || row.assessment.title
      if (name) names.add(name)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es'))
  }, [rows])

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const typeName = row.assessment.activityType?.name || row.assessment.title
      if (typeApplied && typeName !== typeApplied) return false
      if (commentApplied) {
        const hay = `${row.comment ?? ''} ${row.assessment.title}`.toLowerCase()
        if (!hay.includes(commentApplied.toLowerCase())) return false
      }
      return true
    })
  }, [rows, typeApplied, commentApplied])

  async function removeRow(row: StudentGradeRow) {
    if (!globalThis.confirm('¿Borrar esta calificación?')) return
    setBusyKey(`${row.assessmentId}-${row.studentId}`)
    setError(null)
    try {
      await api(`/gradebook/${gradeBookId}/assessments/${row.assessmentId}/grades/${row.studentId}`, {
        method: 'DELETE',
      })
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white px-3 py-2">
        <label className="text-sm">
          <span className="mr-2 text-slate-600">Tipo</span>
          <select
            value={typeDraft}
            onChange={(e) => setTypeDraft(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="">Todos</option>
            {typeOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-sm">
          <span className="mr-2 text-slate-600">Comentario</span>
          <input
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setTypeDraft('')
            setCommentDraft('')
            setTypeApplied('')
            setCommentApplied('')
          }}
          className="text-sm font-semibold uppercase text-sky-800 hover:underline"
        >
          Limpiar
        </button>
        <button
          type="button"
          onClick={() => {
            setTypeApplied(typeDraft)
            setCommentApplied(commentDraft.trim())
          }}
          className="rounded bg-sky-900 px-4 py-1.5 text-sm font-semibold uppercase text-white hover:bg-sky-950"
        >
          Buscar
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {editingKey && options && (() => {
        const row = rows.find((r) => `${r.assessmentId}-${r.studentId}` === editingKey)
        if (!row) return null
        return (
          <EditGradeForm
            gradeBookId={gradeBookId}
            student={student}
            row={row}
            options={options}
            onCancel={() => setEditingKey(null)}
            onSaved={async () => {
              setEditingKey(null)
              await onSaved()
            }}
          />
        )
      })()}

      <div className="overflow-x-auto rounded border border-slate-200">
        {visibleRows.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">Sin calificaciones para el filtro.</p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-sky-50 text-xs uppercase text-slate-600">
              <tr>
                {canGrade && <th className="px-2 py-2 font-semibold">Acciones</th>}
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Tipo</th>
                <th className="px-3 py-2 font-semibold">Calificación</th>
                <th className="px-3 py-2 font-semibold">Comentario</th>
                <th className="px-3 py-2 font-semibold">Registrado por</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const key = `${row.assessmentId}-${row.studentId}`
                return (
                  <tr key={key} className="odd:bg-white even:bg-sky-50/40">
                    {canGrade && (
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingKey(key)}
                            className="rounded p-1 text-sky-700 hover:bg-sky-100"
                            aria-label="Editar calificación"
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busyKey === key}
                            onClick={() => void removeRow(row)}
                            className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                            aria-label="Borrar calificación"
                            title="Borrar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700">{row.assessment.date}</td>
                    <td className="px-3 py-1.5 text-slate-700">
                      {row.assessment.activityType?.name || row.assessment.title}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-slate-900">
                      {row.isAbsent
                        ? 'Ausente'
                        : formatHundredths(row.valueHundredths, row.assessment.gradingScale?.decimals ?? decimals)}
                    </td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-slate-600" title={row.comment || row.assessment.title}>
                      {row.comment || row.assessment.title}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{row.gradedByName?.trim() || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function StudentCard({
  index,
  student,
  courseLabel,
  periods,
  rows,
  decimals,
  canGrade,
  options,
  gradeBookId,
  adding,
  detailOpen,
  onToggleAdd,
  onToggleDetail,
  onSaved,
}: {
  index: number
  student: RosterStudent
  courseLabel: string
  periods: Period[]
  rows: StudentGradeRow[]
  decimals: number
  canGrade: boolean
  options: Options | null
  gradeBookId: string
  adding: boolean
  detailOpen: boolean
  onToggleAdd: () => void
  onToggleDetail: () => void
  onSaved: () => Promise<void>
}) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        {/* Espacio reservado para foto; todavía no hay imagen en libreta. */}
        <div
          aria-hidden
          className="h-20 w-16 shrink-0 rounded border border-dashed border-slate-300 bg-slate-50"
        />

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {index + 1}</p>
          <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline text-xs text-slate-500">Apellidos: </dt>
              <dd className="inline font-semibold text-sky-900">{student.lastName}</dd>
            </div>
            <div>
              <dt className="inline text-xs text-slate-500">Nombres: </dt>
              <dd className="inline font-semibold text-sky-900">{student.firstName}</dd>
            </div>
            <div>
              <dt className="inline text-xs text-slate-500">Documento: </dt>
              <dd className="inline font-mono text-sky-900">{student.documentId || '—'}</dd>
            </div>
            <div>
              <dt className="inline text-xs text-slate-500">Curso/Asig: </dt>
              <dd className="inline font-semibold text-sky-900">{courseLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          {canGrade && (
            <button
              type="button"
              onClick={onToggleAdd}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-teal-600 text-teal-700 hover:bg-teal-50"
              aria-label={`Agregar calificación a ${studentFullName(student)}`}
              title="Agregar calificación"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {periods.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {periods.map((period) => (
            <PeriodBlock
              key={period.id}
              period={period}
              summary={periodSummary(rows, period.id)}
              decimals={decimals}
            />
          ))}
        </div>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={onToggleDetail}
          className="inline-flex items-center gap-1 text-xs font-medium text-sky-800 hover:underline"
        >
          {detailOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {detailOpen ? 'Ocultar detalle' : 'Mostrar detalle'}
        </button>
      </div>

      {adding && options && (
        <AddGradeForm
          gradeBookId={gradeBookId}
          student={student}
          courseLabel={courseLabel}
          options={options}
          onCancel={onToggleAdd}
          onSaved={onSaved}
        />
      )}

      {detailOpen && (
        <StudentDetailPanel
          gradeBookId={gradeBookId}
          student={student}
          rows={rows}
          decimals={decimals}
          canGrade={canGrade}
          options={options}
          onSaved={onSaved}
        />
      )}
    </li>
  )
}

export default function EvaluationsBoard({
  gradeBookId,
  detail,
}: {
  gradeBookId: string
  detail: GradeBookDetail
}) {
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [focusIndex, setFocusIndex] = useState(0)
  const [showAll, setShowAll] = useState(true)
  const [addingStudentId, setAddingStudentId] = useState<string | null>(null)
  const [detailStudentIds, setDetailStudentIds] = useState<Set<string>>(() => new Set())
  const [showLegacy, setShowLegacy] = useState(false)

  const courseLabel = useMemo(
    () => `${detail.course.name} · ${detail.subject.name}`,
    [detail.course.name, detail.subject.name],
  )
  const title = useMemo(() => gradeBookTitle(detail), [detail])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [boardRes, opts] = await Promise.all([
        api<BoardResponse>(`/gradebook/${gradeBookId}/grades-board`),
        api<Options>(`/gradebook/${gradeBookId}/options`),
      ])
      setBoard(boardRes)
      setOptions(opts)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las evaluaciones')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  const assessmentById = useMemo(() => {
    const map = new Map<string, BoardAssessment>()
    for (const a of board?.assessments ?? []) map.set(a.id, a)
    return map
  }, [board])

  const rowsByStudent = useMemo(() => {
    const map = new Map<string, StudentGradeRow[]>()
    for (const grade of board?.grades ?? []) {
      const assessment = assessmentById.get(grade.assessmentId)
      if (!assessment) continue
      const row: StudentGradeRow = {
        ...grade,
        assessment,
        category: activityCategory(assessment.activityType?.code),
      }
      const bucket = map.get(grade.studentId)
      if (bucket) bucket.push(row)
      else map.set(grade.studentId, [row])
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => a.assessment.date.localeCompare(b.assessment.date))
    }
    return map
  }, [board, assessmentById])

  const periods = options?.periods ?? []
  const decimals = options?.scales[0]?.decimals ?? 0

  const filteredStudents = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return detail.students
    return detail.students.filter((s) => {
      const hay = `${s.lastName} ${s.firstName} ${s.documentId ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [detail.students, filter])

  const visibleStudents = showAll
    ? filteredStudents
    : filteredStudents.slice(focusIndex, focusIndex + 1)

  useEffect(() => {
    if (focusIndex >= filteredStudents.length) setFocusIndex(Math.max(0, filteredStudents.length - 1))
  }, [filteredStudents.length, focusIndex])

  function toggleDetail(studentId: string) {
    setDetailStudentIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  function toggleDetailAll() {
    if (detailStudentIds.size === filteredStudents.length) {
      setDetailStudentIds(new Set())
      return
    }
    setDetailStudentIds(new Set(filteredStudents.map((s) => s.studentId)))
  }

  if (loading && !board) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando evaluaciones…
      </p>
    )
  }

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-2">
        <div>
          <h2 className="text-base font-bold uppercase tracking-wide text-teal-800">
            Orales, escritos y o. actividades
          </h2>
          <p className="text-sm text-slate-600">{title}</p>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2">
        <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-sm">
          <Search className="h-4 w-4 text-slate-400" aria-hidden />
          <input
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setFocusIndex(0)
              setShowAll(true)
            }}
            placeholder="Filtrar por alumno"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setShowAll(true)
            setFocusIndex(0)
          }}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase text-slate-700 hover:bg-slate-50"
        >
          Todos
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={filteredStudents.length === 0}
            onClick={() => {
              setShowAll(false)
              setFocusIndex((i) => Math.max(0, i - 1))
            }}
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Alumno anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={filteredStudents.length === 0}
            onClick={() => {
              setShowAll(false)
              setFocusIndex((i) => Math.min(filteredStudents.length - 1, i + 1))
            }}
            className="rounded border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Alumno siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={toggleDetailAll}
          className="text-xs font-medium text-sky-800 hover:underline"
        >
          Mostrar / ocultar detalle (todos)
        </button>
      </div>

      {filteredStudents.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          No hay estudiantes para mostrar.
        </p>
      ) : (
        <ul className="space-y-3">
          {visibleStudents.map((student) => {
            const index = detail.students.findIndex((s) => s.studentId === student.studentId)
            return (
              <StudentCard
                key={student.studentId}
                index={index >= 0 ? index : 0}
                student={student}
                courseLabel={courseLabel}
                periods={periods}
                rows={rowsByStudent.get(student.studentId) ?? []}
                decimals={decimals}
                canGrade={detail.access.canGrade}
                options={options}
                gradeBookId={gradeBookId}
                adding={addingStudentId === student.studentId}
                detailOpen={detailStudentIds.has(student.studentId)}
                onToggleAdd={() =>
                  setAddingStudentId((id) => (id === student.studentId ? null : student.studentId))
                }
                onToggleDetail={() => toggleDetail(student.studentId)}
                onSaved={async () => {
                  setAddingStudentId(null)
                  await load()
                }}
              />
            )
          })}
        </ul>
      )}

      {detail.access.canGrade && options && (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Importar desde Moodle
          </summary>
          <div className="mt-3">
            <MoodleImportPanel
              gradeBookId={gradeBookId}
              periods={options.periods}
              scales={options.scales}
              onImported={() => void load()}
            />
          </div>
        </details>
      )}

      <details
        className="rounded-lg border border-slate-200 bg-white p-3"
        open={showLegacy}
        onToggle={(e) => setShowLegacy((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-medium text-slate-700">
          Vista planilla por evaluación (avanzada)
        </summary>
        <div className="mt-3">
          <AssessmentsPanel gradeBookId={gradeBookId} canGrade={detail.access.canGrade} />
        </div>
      </details>
    </section>
  )
}
