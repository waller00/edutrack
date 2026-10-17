'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { useStudentPhoto } from '@/lib/hooks/useStudentPhoto'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import {
  ACTIVITY_CATEGORY_ORDER,
  ACTIVITY_CATEGORY_TITLE,
  activityCategory,
  type ActivityCategory,
} from '@/lib/gradebook/activity-category'
import {
  gradablePeriods,
  mergePeriodGrade,
  periodKind,
  tramoForDate,
  type LibretaPeriod,
  type StoredPeriodGrade,
} from '@/lib/gradebook/period-blocks'
import { studentFullName } from '@/lib/gradebook/labels'
import { gradeSelectFromHundredths, gradeSelectToHundredths, type GradeRange } from '@/lib/gradebook/grade-scale'
import { todayYmdUruguay as todayYmd } from '@/lib/libreta/absence-day'
import {
  downloadStudentEvaluationsXlsx,
  printStudentEvaluations,
} from '@/lib/gradebook/student-evaluation-export'
import type { GradeBookDetail, RosterStudent } from '@/lib/gradebook/types'
import { libretaCode } from '@/components/libreta/MisLibretas'
import StudentBadges, { type StudentBadgeFocus } from '@/components/libreta/StudentBadges'
import StudentSheet from '@/components/libreta/StudentSheet'
import StudentCombobox from '@/components/forms/StudentCombobox'
import MoodleImportPanel from './MoodleImportPanel'
import AssessmentsPanel from './AssessmentsPanel'
import PeriodBlock, { type BlockLevel, type PeriodGradePatch } from './PeriodBlock'
import GradeSelect from './GradeSelect'
import type { ConductOption } from './ConductSelect'
import StudentHistory from './StudentHistory'
import ScrollRegion from '@/components/common/ScrollRegion'

type Period = LibretaPeriod
type Scale = GradeRange & { id: string; name: string; kind: 'NUMERIC' | 'ORDINAL'; decimals: number; levels?: BlockLevel[] }
type ActivityType = { id: string; code: string; name: string; scope: 'GLOBAL' | 'TEACHER'; category?: string | null }
type Options = {
  periods: Period[]
  scales: Scale[]
  activityTypes: ActivityType[]
  /** Escala del nivel (1–10 o 1–12): con ella se ponen las notas nuevas y R. */
  periodScale?: Scale | null
  /** Escala de conducta: las opciones de C. */
  conduct?: ConductOption[]
}

/** Desde qué celda se abrió la carga: la planilla se llena clickeando en la columna. */
type AddPreset = { periodId?: string; category?: ActivityCategory }


/** Primer tipo de actividad de una columna de la planilla, para precargar el formulario. */
function firstTypeOf(activityTypes: ActivityType[], category: ActivityCategory | undefined): string {
  const match = category ? activityTypes.find((t) => activityCategory(t) === category) : undefined
  return match?.id ?? activityTypes[0]?.id ?? ''
}

/** Tipos agrupados por columna (Or / Otras / Ev / Prueba), como están en la planilla. */
function ActivityTypeOptions({ activityTypes }: { activityTypes: ActivityType[] }) {
  return (
    <>
      {ACTIVITY_CATEGORY_ORDER.map((category) => {
        const types = activityTypes.filter((t) => activityCategory(t) === category)
        if (types.length === 0) return null
        return (
          <optgroup key={category} label={ACTIVITY_CATEGORY_TITLE[category]}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
        )
      })}
    </>
  )
}

/**
 * Escala con la que se ponen las notas nuevas: la del nivel de la libreta. Sólo si el backend no
 * la tiene sembrada cae en la primera numérica activa.
 */
function levelScaleOf(options: Options): Scale | null {
  return options.periodScale ?? options.scales.find((s) => s.kind === 'NUMERIC') ?? options.scales[0] ?? null
}

/** "No rindió": se distingue de "sin nota" y el control lo cuenta como cargado. */
function AbsentCheck({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300"
      />
      No rindió
    </label>
  )
}

type BoardAssessment = {
  id: string
  periodId: string
  period: Period | null
  date: string
  title: string
  /** `INDIVIDUAL`: nota suelta de un alumno, creada desde su carta. */
  scope?: 'GROUP' | 'INDIVIDUAL'
  activityType: { id: string; code: string; name: string; category?: string | null } | null
  gradingScale: (Partial<GradeRange> & { id: string; name: string; kind: string; decimals: number }) | null
  /** Quién la cargó; `isSubstitute` si fue un suplente de esta libreta. */
  author?: { id: string; name: string | null; isSubstitute: boolean } | null
}

/** Nombre del suplente que cargó la evaluación, o null si la cargó el titular (u otro). */
function substituteNameOf(assessment: Pick<BoardAssessment, 'author'>): string | null {
  return assessment.author?.isSubstitute ? assessment.author.name ?? 'suplente' : null
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

type PeriodState = { periodId: string; status: 'OPEN' | 'CLOSED' | 'REOPENED'; canEdit: boolean }

type BoardResponse = {
  assessments: BoardAssessment[]
  grades: BoardGrade[]
  /** C, R y el texto de cada alumno por período. */
  periodGrades?: StoredPeriodGrade[]
  periodStates?: PeriodState[]
}

type StudentGradeRow = BoardGrade & {
  assessment: BoardAssessment
  category: ActivityCategory
}

function AddGradeForm({
  gradeBookId,
  student,
  courseLabel,
  options,
  preset,
  onCancel,
  onSaved,
}: {
  gradeBookId: string
  student: RosterStudent
  courseLabel: string
  options: Options
  preset: AddPreset
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const scale = levelScaleOf(options)
  const gradingScaleId = scale?.id ?? ''
  // Las notas sueltas sólo van en los tramos; las entregas llevan C, R e informe.
  const tramos = gradablePeriods(options.periods)
  const [activityTypeId, setActivityTypeId] = useState(() => firstTypeOf(options.activityTypes, preset.category))
  const [periodId, setPeriodId] = useState(
    () => preset.periodId ?? tramoForDate(options.periods, todayYmd())?.id ?? tramos[0]?.id ?? '',
  )
  const [date, setDate] = useState(todayYmd)
  const [gradeSelect, setGradeSelect] = useState('')
  const [absent, setAbsent] = useState(false)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const activity = options.activityTypes.find((t) => t.id === activityTypeId)
  const canSubmit = Boolean(activityTypeId && periodId && gradingScaleId && date) && !saving
  const firstFieldRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !saving) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      const title = comment.trim() || `${activity?.name ?? 'Evaluación'} — ${date}`
      // Nota suelta de este alumno: el control no la cruza contra el grupo entero.
      const created = await api<{ data: { id: string } }>(`/gradebook/${gradeBookId}/assessments`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          date,
          periodId,
          gradingScaleId,
          scope: 'INDIVIDUAL',
          ...(activityTypeId ? { activityTypeId } : {}),
        }),
      })
      await api(`/gradebook/${gradeBookId}/assessments/${created.data.id}/grades`, {
        method: 'PUT',
        body: JSON.stringify({
          entries: [
            {
              studentId: student.studentId,
              valueHundredths: absent ? null : gradeSelectToHundredths(gradeSelect),
              isAbsent: absent,
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

  return createPortal(
    <div
      className="responsive-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-grade-title"
      onMouseDown={(e) => {
        // Clic en el fondo cierra, salvo mientras guarda: no se pierde una nota a medio mandar.
        if (e.target === e.currentTarget && !saving) onCancel()
      }}
    >
      <form className="responsive-modal-panel max-w-lg space-y-4" onSubmit={(e) => void handleSubmit(e)}>
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="add-grade-title" className="text-lg font-semibold text-gray-900">
              Nueva calificación
            </h2>
            <p className="mt-0.5 truncate text-sm text-gray-600">
              <span className="font-medium text-gray-900">{studentFullName(student)}</span>
              {courseLabel ? ` · ${courseLabel}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-gray-700">
              Calificar <span className="text-red-600" aria-hidden>*</span>
            </span>
            <select
              ref={firstFieldRef}
              required
              value={activityTypeId}
              onChange={(e) => setActivityTypeId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            >
              <ActivityTypeOptions activityTypes={options.activityTypes} />
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">
              Período <span className="text-red-600" aria-hidden>*</span>
            </span>
            <select
              required
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            >
              {tramos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">
              Fecha <span className="text-red-600" aria-hidden>*</span>
            </span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>
        </div>

        <div className="rounded-xl bg-amber-50/60 p-3">
          <span className="mb-2 block text-sm font-medium text-gray-700" aria-hidden>Calificación</span>
          <span className="flex flex-wrap items-center gap-4">
            <GradeSelect
              value={gradeSelect}
              scale={scale}
              onChange={setGradeSelect}
              disabled={saving || absent}
              className="w-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base font-semibold disabled:opacity-50"
            />
            <AbsentCheck checked={absent} onChange={setAbsent} disabled={saving} />
          </span>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-medium text-gray-700">Comentario</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="rounded-lg border border-gray-300 px-3 py-2"
            placeholder="Opcional. Si lo completás, se usa como título de la evaluación."
          />
        </label>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        )}

        <footer className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={!canSubmit} className="btn-primary text-sm">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

type GroupCell = { grade: string; absent: boolean }

/**
 * Una actividad para todo el grupo, con la nota de cada alumno en la misma pantalla.
 *
 * Es el mismo formulario que "Nueva calificación" de la carta (qué se califica, período, fecha),
 * pero la evaluación es del grupo y abajo está la lista entera: se pone la nota de uno por uno y
 * se guarda todo junto, en vez de abrir la carta de cada alumno.
 */
function GroupGradeForm({
  gradeBookId,
  students,
  courseLabel,
  options,
  onCancel,
  onSaved,
}: {
  gradeBookId: string
  students: readonly RosterStudent[]
  courseLabel: string
  options: Options
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const scale = levelScaleOf(options)
  const gradingScaleId = scale?.id ?? ''
  const tramos = gradablePeriods(options.periods)
  const [activityTypeId, setActivityTypeId] = useState(() => firstTypeOf(options.activityTypes, undefined))
  const [periodId, setPeriodId] = useState(() => tramoForDate(options.periods, todayYmd())?.id ?? tramos[0]?.id ?? '')
  const [date, setDate] = useState(todayYmd)
  const [title, setTitle] = useState('')
  const [cells, setCells] = useState<Record<string, GroupCell>>({})
  // Si la evaluación se creó y fallaron las notas, el reintento no la vuelve a crear.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const firstFieldRef = useRef<HTMLSelectElement>(null)

  const activity = options.activityTypes.find((t) => t.id === activityTypeId)
  const cellOf = (studentId: string): GroupCell => cells[studentId] ?? { grade: '', absent: false }
  const done = students.filter((s) => cellOf(s.studentId).absent || cellOf(s.studentId).grade !== '').length
  const canSubmit = Boolean(activityTypeId && periodId && gradingScaleId && date) && !saving

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !saving) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  function patch(studentId: string, change: Partial<GroupCell>) {
    setCells((prev) => ({ ...prev, [studentId]: { ...cellOf(studentId), ...prev[studentId], ...change } }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      let assessmentId = createdId
      if (!assessmentId) {
        const created = await api<{ data: { id: string } }>(`/gradebook/${gradeBookId}/assessments`, {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim() || `${activity?.name ?? 'Evaluación'} — ${date}`,
            date,
            periodId,
            gradingScaleId,
            // Del grupo: el control de libretas pide nota (o "no rindió") de todos.
            scope: 'GROUP',
            ...(activityTypeId ? { activityTypeId } : {}),
          }),
        })
        assessmentId = created.data.id
        setCreatedId(assessmentId)
      }
      const entries = students.flatMap((student) => {
        const cell = cellOf(student.studentId)
        if (cell.absent) return [{ studentId: student.studentId, valueHundredths: null, isAbsent: true, comment: null }]
        if (cell.grade === '') return []
        return [
          {
            studentId: student.studentId,
            valueHundredths: gradeSelectToHundredths(cell.grade),
            isAbsent: false,
            comment: null,
          },
        ]
      })
      if (entries.length > 0) {
        await api(`/gradebook/${gradeBookId}/assessments/${assessmentId}/grades`, {
          method: 'PUT',
          body: JSON.stringify({ entries }),
        })
      }
      await onSaved()
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'No se pudo guardar'
      setError(createdId ? `La actividad ya está creada, pero no se guardaron las notas: ${reason}` : reason)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="responsive-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-grade-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel()
      }}
    >
      <form className="responsive-modal-panel max-w-2xl space-y-4" onSubmit={(e) => void handleSubmit(e)}>
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="group-grade-title" className="text-lg font-semibold text-gray-900">
              Calificar a todo el grupo
            </h2>
            <p className="mt-0.5 truncate text-sm text-gray-600">
              Una actividad para todos{courseLabel ? ` · ${courseLabel}` : ''}. Poné la nota de cada uno y guardá todo junto.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <fieldset disabled={Boolean(createdId)} className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-gray-700">
              Calificar <span className="text-red-600" aria-hidden>*</span>
            </span>
            <select
              ref={firstFieldRef}
              required
              value={activityTypeId}
              onChange={(e) => setActivityTypeId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            >
              <ActivityTypeOptions activityTypes={options.activityTypes} />
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">
              Período <span className="text-red-600" aria-hidden>*</span>
            </span>
            <select
              required
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            >
              {tramos.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">
              Fecha <span className="text-red-600" aria-hidden>*</span>
            </span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-gray-700">Título</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2"
              placeholder="Opcional. Por ejemplo: Escrito 1 – Célula"
            />
          </label>
        </fieldset>

        <section aria-labelledby="group-grade-list" className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="group-grade-list" className="text-sm font-semibold text-gray-900">Notas del grupo</h3>
            <p className="text-xs tabular-nums text-gray-500" aria-live="polite">
              {done} de {students.length} con nota o &quot;no rindió&quot;
            </p>
          </div>
          {students.length === 0 ? (
            <p className="rounded-lg border border-gray-200 px-3 py-4 text-sm text-gray-500">
              El grupo no tiene estudiantes matriculados.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
              {students.map((student, index) => {
                const cell = cellOf(student.studentId)
                const name = studentFullName(student)
                return (
                  <li key={student.studentId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="w-6 text-right text-xs tabular-nums text-gray-400">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{name}</span>
                    <GradeSelect
                      value={cell.grade}
                      scale={scale}
                      onChange={(grade) => patch(student.studentId, { grade })}
                      disabled={saving || cell.absent}
                      aria-label={`Nota de ${name}`}
                      className="w-24 rounded-lg border border-gray-300 bg-amber-50 px-2 py-1.5 text-sm font-semibold tabular-nums disabled:opacity-50"
                    />
                    <AbsentCheck
                      checked={cell.absent}
                      onChange={(absent) => patch(student.studentId, { absent })}
                      disabled={saving}
                    />
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-gray-500">
            Los que dejes sin nota quedan pendientes: después los completás desde &quot;Evaluaciones del grupo&quot; o
            desde su carta.
          </p>
        </section>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        )}

        <footer className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={!canSubmit} className="btn-primary text-sm">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
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
  // La nota se edita con la escala de SU evaluación: es contra la que valida el backend.
  const scale: GradeRange | null = row.assessment.gradingScale
    ? {
        minValueHundredths: row.assessment.gradingScale.minValueHundredths ?? null,
        maxValueHundredths: row.assessment.gradingScale.maxValueHundredths ?? null,
      }
    : levelScaleOf(options)
  const gradingScaleId = row.assessment.gradingScale?.id ?? levelScaleOf(options)?.id ?? ''
  // Una nota suelta es del alumno: se edita entera. De una evaluación del grupo sólo se toca la
  // nota de este alumno; cambiarle título, fecha o período desde acá lo cambiaba para todos.
  const individual = row.assessment.scope === 'INDIVIDUAL'
  const [activityTypeId, setActivityTypeId] = useState(row.assessment.activityType?.id ?? options.activityTypes[0]?.id ?? '')
  const [periodId, setPeriodId] = useState(row.assessment.periodId)
  const [date, setDate] = useState(row.assessment.date)
  const [gradeSelect, setGradeSelect] = useState(gradeSelectFromHundredths(row.valueHundredths))
  const [absent, setAbsent] = useState(row.isAbsent)
  const [comment, setComment] = useState(row.comment || (individual ? row.assessment.title : ''))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSubmit = Boolean(periodId && gradingScaleId && date) && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      if (individual) {
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
      }
      await api(`/gradebook/${gradeBookId}/assessments/${row.assessmentId}/grades`, {
        method: 'PUT',
        body: JSON.stringify({
          entries: [
            {
              studentId: student.studentId,
              valueHundredths: absent ? null : gradeSelectToHundredths(gradeSelect),
              isAbsent: absent,
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
      {!individual && (
        <p className="text-xs text-slate-600">
          {row.assessment.title} · {row.assessment.date}: es una evaluación del grupo, así que acá se cambia sólo
          la nota de este alumno.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {individual && (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-gray-600">Tipo</span>
              <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5">
                <ActivityTypeOptions activityTypes={options.activityTypes} />
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-gray-600">Período</span>
              <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5">
                {gradablePeriods(options.periods).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-gray-600">Fecha</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5" />
            </label>
          </>
        )}
        <div className="text-sm">
          <span className="mb-1 block text-xs text-gray-600" aria-hidden>Calificación</span>
          <span className="flex flex-wrap items-center gap-3">
            <GradeSelect
              value={gradeSelect}
              scale={scale}
              onChange={setGradeSelect}
              disabled={saving || absent}
              className="w-full max-w-[10rem] rounded border border-gray-300 bg-amber-50 px-2 py-1.5 disabled:opacity-50"
            />
            <AbsentCheck checked={absent} onChange={setAbsent} disabled={saving} />
          </span>
        </div>
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
  ownWorkOnly = false,
}: {
  gradeBookId: string
  student: RosterStudent
  rows: StudentGradeRow[]
  decimals: number
  canGrade: boolean
  options: Options | null
  onSaved: () => Promise<void>
  /** Suplente: sin el historial de cambios, que es de la libreta del titular. */
  ownWorkOnly?: boolean
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

      <ScrollRegion label="Detalle de calificaciones" className="overflow-x-auto rounded border border-slate-200">
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
                      {substituteNameOf(row.assessment) && (
                        <span className="ml-2 whitespace-nowrap rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
                          Suplente: {substituteNameOf(row.assessment)}
                        </span>
                      )}
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
      </ScrollRegion>

      {!ownWorkOnly && <StudentHistory gradeBookId={gradeBookId} studentId={student.studentId} />}
    </div>
  )
}

/** La foto de la tarjeta; la misma URL sirve para imprimir, así se pide una sola vez. */
function StudentPhoto({ url, initials }: { url: string | null; initials: string }) {
  if (!url) {
    return (
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-600"
      >{initials}</div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover"
    />
  )
}

function StudentCard({
  index,
  student,
  courseLabel,
  libretaLabel,
  detail,
  periods,
  rows,
  periodGrades,
  periodStates,
  levels,
  decimals,
  scale,
  canGrade,
  options,
  gradeBookId,
  addPreset,
  detailOpen,
  onToggleAdd,
  onToggleDetail,
  onOpenSheet,
  onSaved,
  onSavePeriodGrade,
}: {
  index: number
  student: RosterStudent
  courseLabel: string
  libretaLabel: string
  detail: GradeBookDetail
  periods: Period[]
  rows: StudentGradeRow[]
  periodGrades: StoredPeriodGrade[]
  periodStates: Map<string, PeriodState>
  levels: BlockLevel[]
  decimals: number
  scale: GradeRange | null
  canGrade: boolean
  options: Options | null
  gradeBookId: string
  /** Formulario de carga abierto, con lo que precargó la celda; null si está cerrado. */
  addPreset: AddPreset | null
  detailOpen: boolean
  onToggleAdd: (preset?: AddPreset) => void
  onToggleDetail: () => void
  onOpenSheet: (focus: StudentBadgeFocus) => void
  onSaved: () => Promise<void>
  onSavePeriodGrade: (periodId: string, patch: PeriodGradePatch) => Promise<void>
}) {
  const [exportBusy, setExportBusy] = useState<'print' | 'xlsx' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  // El suplente ve sólo sus notas: ni imprime ni exporta la carta, que es del titular.
  const ownWorkOnly = Boolean(detail.access.ownWorkOnly)
  // El Excel sale del servidor y pide `gradebook.export` (inspección no lo tiene); imprimir es local.
  const canExport = hasPermission(useOptionalAuth()?.me, 'gradebook.export') && !ownWorkOnly
  const photoUrl = useStudentPhoto(gradeBookId, student.studentId, student.hasPhoto)

  async function handlePrint() {
    setExportBusy('print')
    setExportError(null)
    try {
      printStudentEvaluations({
        detail,
        student,
        index,
        libretaLabel,
        photoUrl,
        rows: rows.map((r) => ({
          date: r.assessment.date,
          typeName: r.assessment.activityType?.name || r.assessment.title,
          valueHundredths: r.valueHundredths,
          isAbsent: r.isAbsent,
          comment: r.comment,
          periodName: r.assessment.period?.name || 'Sin período',
          decimals: r.assessment.gradingScale?.decimals ?? decimals,
          category: r.category,
        })),
        periods,
        decimals,
        periodResults: Object.fromEntries(
          periods.map((period) => {
            const saved = periodGrades.find((g) => g.periodId === period.id)
            return [
              period.name,
              {
                c: saved?.valueHundredths ?? null,
                r: saved?.meetingValueHundredths ?? null,
                judgement: saved?.conceptualJudgement ?? null,
              },
            ]
          }),
        ),
      })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'No se pudo imprimir')
    } finally {
      setExportBusy(null)
    }
  }

  async function handleExcel() {
    setExportBusy('xlsx')
    setExportError(null)
    try {
      await downloadStudentEvaluationsXlsx(gradeBookId, student.studentId)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'No se pudo exportar')
    } finally {
      setExportBusy(null)
    }
  }

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <StudentPhoto url={photoUrl} initials={`${student.lastName[0] ?? ''}${student.firstName[0] ?? ''}`.toUpperCase()} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {index + 1}</p>
              <StudentBadges
                className="mt-0"
                codes={student.badges}
                onSelect={(_code, focus) => onOpenSheet(focus)}
              />
            </div>
            <h3 className="mt-1 text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{studentFullName(student)}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {student.documentId && <span className="mr-3 font-mono">{student.documentId}</span>}
              {courseLabel}
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
            {canGrade && (
              <button
                type="button"
                onClick={() => onToggleAdd()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white transition-colors hover:bg-emerald-700"
                aria-label={`Agregar calificación a ${studentFullName(student)}`}
                title="Agregar calificación"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            {!ownWorkOnly && (
              <button
                type="button"
                disabled={exportBusy !== null}
                onClick={() => void handlePrint()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Imprimir evaluaciones del alumno"
                title="Imprimir"
              >
                {exportBusy === 'print' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              </button>
            )}
            {canExport && (
              <button
                type="button"
                disabled={exportBusy !== null}
                onClick={() => void handleExcel()}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Exportar Excel del alumno"
                title="Exportar a Excel"
              >
                {exportBusy === 'xlsx' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {periods.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] items-start gap-3 border-t border-slate-100 pt-4">
            {periods.map((period) => {
              const state = periodStates.get(period.id)
              return (
                <PeriodBlock
                  key={period.id}
                  period={period}
                  grades={rows
                    .filter((r) => r.assessment.periodId === period.id)
                    .map((r) => ({
                      key: r.assessmentId,
                      category: r.category,
                      valueHundredths: r.valueHundredths,
                      isAbsent: r.isAbsent,
                      date: r.assessment.date,
                      title: r.assessment.title,
                      comment: r.comment,
                      substituteName: substituteNameOf(r.assessment),
                    }))}
                  saved={periodGrades.find((g) => g.periodId === period.id) ?? null}
                  levels={levels}
                  decimals={decimals}
                  scale={scale}
                  conduct={options?.conduct ?? []}
                  status={state?.status}
                  editable={canGrade && (state?.canEdit ?? false)}
                  onSave={(patch) => onSavePeriodGrade(period.id, patch)}
                  onAddGrade={(category) => onToggleAdd({ periodId: period.id, category })}
                  ownGradesOnly={ownWorkOnly}
                />
              )
            })}
          </div>
        )}
      </div>

      {exportError && (
        <p role="alert" className="mt-2 text-sm text-red-700">{exportError}</p>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onToggleDetail}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-medium text-slate-600 hover:text-emerald-700"
          aria-expanded={detailOpen}
        >
          {detailOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {detailOpen ? 'Ocultar detalle' : 'Mostrar detalle'}
        </button>
      </div>

      {addPreset && options && (
        <AddGradeForm
          key={`${addPreset.periodId ?? ''}-${addPreset.category ?? ''}`}
          gradeBookId={gradeBookId}
          student={student}
          courseLabel={courseLabel}
          options={options}
          preset={addPreset}
          onCancel={() => onToggleAdd()}
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
          ownWorkOnly={ownWorkOnly}
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
  const searchParams = useSearchParams()
  const alumnoParam = searchParams.get('alumno')
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [options, setOptions] = useState<Options | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const [showAll, setShowAll] = useState(() => !alumnoParam)
  const [periodFilter, setPeriodFilter] = useState('')
  useEffect(() => { setPeriodFilter('') }, [gradeBookId])
  const [adding, setAdding] = useState<{ studentId: string; preset: AddPreset } | null>(null)
  const [detailStudentIds, setDetailStudentIds] = useState<Set<string>>(() => new Set())
  const [showGroupSheet, setShowGroupSheet] = useState(false)
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  // Vuelve a montar la lista de evaluaciones del grupo después de crear una desde arriba.
  const [groupPanelKey, setGroupPanelKey] = useState(0)
  const [sheetStudent, setSheetStudent] = useState<{
    studentId: string
    focus: StudentBadgeFocus
  } | null>(null)

  const courseLabel = useMemo(
    () => `${detail.course.name} · ${detail.subject.name}`,
    [detail.course.name, detail.subject.name],
  )
  const libretaLabel = useMemo(() => libretaCode(detail), [detail])

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
        category: activityCategory(assessment.activityType),
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
  const levelScale = options ? levelScaleOf(options) : null
  const decimals = levelScale?.decimals ?? 0
  const students = detail.students
  // Colores y símbolos por tramo: los de la escala del nivel, nunca un umbral fijo.
  const levels = levelScale?.levels ?? []
  const periodStates = useMemo(
    () => new Map((board?.periodStates ?? []).map((state) => [state.periodId, state])),
    [board],
  )

  /** Guarda C, R o el texto de una celda. Es parcial: lo que no viene no se toca. */
  async function savePeriodGrade(studentId: string, periodId: string, patch: PeriodGradePatch) {
    await api(`/gradebook/${gradeBookId}/students/${studentId}/closure`, {
      method: 'PUT',
      body: JSON.stringify({ entries: [{ periodId, ...patch }] }),
    })
    setBoard((prev) =>
      prev ? { ...prev, periodGrades: mergePeriodGrade(prev.periodGrades ?? [], periodId, studentId, patch) } : prev,
    )
  }

  function toggleAdd(studentId: string, preset?: AddPreset) {
    setAdding((current) => {
      const sameCell =
        current?.studentId === studentId &&
        current.preset.periodId === preset?.periodId &&
        current.preset.category === preset?.category
      return sameCell ? null : { studentId, preset: preset ?? {} }
    })
  }

  const visibleStudents = showAll
    ? students
    : students.slice(focusIndex, focusIndex + 1)

  const selectedStudentId = students[focusIndex]?.studentId ?? ''

  useEffect(() => {
    if (!alumnoParam || students.length === 0) return
    const idx = students.findIndex((s) => s.studentId === alumnoParam)
    if (idx < 0) return
    setFocusIndex(idx)
    setShowAll(false)
  }, [alumnoParam, students])

  useEffect(() => {
    if (focusIndex >= students.length) setFocusIndex(Math.max(0, students.length - 1))
  }, [students.length, focusIndex])

  function toggleDetail(studentId: string) {
    setDetailStudentIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  function toggleDetailAll() {
    if (detailStudentIds.size === students.length && students.length > 0) {
      setDetailStudentIds(new Set())
      return
    }
    setDetailStudentIds(new Set(students.map((s) => s.studentId)))
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
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {detail.access.ownWorkOnly ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">Tus notas de suplencia</h2>
              <p className="text-xs text-slate-500">
                Ves y cargás sólo las notas que pusiste vos. Las del titular, la conducta y el rendimiento no se
                muestran.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Calificaciones
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                C es la conducta (1 al 10); R, el rendimiento que va al boletín.
              </p>
            </>
          )}
        </div>
        {detail.access.canGrade && options && students.length > 0 && (
          <button type="button" onClick={() => setGroupFormOpen(true)} className="btn-primary text-sm">
            <Users className="h-4 w-4" aria-hidden />
            Calificar a todo el grupo
          </button>
        )}
      </header>

      {groupFormOpen && options && (
        <GroupGradeForm
          gradeBookId={gradeBookId}
          students={students}
          courseLabel={courseLabel}
          options={options}
          onCancel={() => setGroupFormOpen(false)}
          onSaved={async () => {
            setGroupFormOpen(false)
            setGroupPanelKey((key) => key + 1)
            await load()
          }}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:flex sm:flex-wrap">
        {/* "Todos los alumnos" es una opción más del buscador, no un filtro aparte. */}
        <StudentCombobox
          students={students}
          value={showAll ? null : selectedStudentId}
          allLabel="Todos los alumnos"
          numbered
          label="Alumno"
          disabled={students.length === 0}
          className="col-span-2 w-full min-w-0 flex-1 sm:min-w-[12rem] [&_input]:min-h-11 [&_input]:rounded-lg [&_input]:border-slate-200 [&_input]:bg-slate-50 [&_label]:mb-1.5"
          onChange={(studentId) => {
            if (studentId === null) {
              setShowAll(true)
              setFocusIndex(0)
              return
            }
            const idx = students.findIndex((s) => s.studentId === studentId)
            if (idx >= 0) {
              setFocusIndex(idx)
              setShowAll(false)
            }
          }}
        />

        <label className="min-w-0 flex-1 sm:max-w-[13rem]">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">Período</span>
          <select aria-label="Filtrar por período" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <option value="">Todos los períodos</option>
            {periods.filter((period) => !detail.access.ownWorkOnly || periodKind(period) === 'TRAMO').map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}
          </select>
        </label>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={students.length === 0 || (!showAll && focusIndex === 0)}
            onClick={() => {
              if (!showAll) setFocusIndex((i) => Math.max(0, i - 1))
              setShowAll(false)
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Alumno anterior"
            title="Alumno anterior"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            disabled={students.length === 0 || (!showAll && focusIndex >= students.length - 1)}
            onClick={() => {
              // Desde "todos", el primero; si no, el que sigue.
              if (!showAll) setFocusIndex((i) => Math.min(students.length - 1, i + 1))
              setShowAll(false)
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Alumno siguiente"
            title="Alumno siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Un escrito o una prueba se carga para todo el grupo en una planilla; la carta queda para
          las notas sueltas de cada alumno. Antes esta planilla estaba al final, como "avanzada". */}
      <details
        className="rounded-xl border border-slate-200 bg-white p-4"
        open={showGroupSheet}
        onToggle={(e) => setShowGroupSheet((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm font-semibold text-teal-800">
          Evaluaciones del grupo: ver y completar las notas de cada una
        </summary>
        <p className="mt-1 text-xs text-slate-500">
          Las actividades que creaste con &quot;Calificar a todo el grupo&quot;. Abrí una para completar las notas
          pendientes con el teclado. El control de libretas exige nota (o &quot;no rindió&quot;) de todo el grupo.
        </p>
        <div className="mt-3">
          <AssessmentsPanel
            key={groupPanelKey}
            gradeBookId={gradeBookId}
            canGrade={detail.access.canGrade}
            allowCreate={false}
            onChanged={() => void load()}
          />
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {showAll ? `${students.length} estudiantes` : students.length > 0 ? `Estudiante ${focusIndex + 1} de ${students.length}` : 'Sin estudiantes'}
        </p>
        <button
          type="button"
          onClick={toggleDetailAll}
          className="inline-flex min-h-9 items-center rounded-lg text-xs font-medium text-slate-600 hover:text-emerald-700"
        >
          Mostrar / ocultar detalle (todos)
        </button>
      </div>

      {students.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          No hay estudiantes para mostrar.
        </p>
      ) : (
        <ul className="space-y-5">
          {visibleStudents.map((student) => {
            const index = detail.students.findIndex((s) => s.studentId === student.studentId)
            return (
              <StudentCard
                key={student.studentId}
                index={index >= 0 ? index : 0}
                student={student}
                courseLabel={courseLabel}
                libretaLabel={libretaLabel}
                detail={detail}
                periods={periodFilter ? periods.filter((period) => period.id === periodFilter) : periods}
                rows={rowsByStudent.get(student.studentId) ?? []}
                periodGrades={(board?.periodGrades ?? []).filter((g) => g.studentId === student.studentId)}
                periodStates={periodStates}
                levels={levels}
                decimals={decimals}
                scale={levelScale}
                canGrade={detail.access.canGrade}
                options={options}
                gradeBookId={gradeBookId}
                addPreset={adding?.studentId === student.studentId ? adding.preset : null}
                detailOpen={detailStudentIds.has(student.studentId)}
                onToggleAdd={(preset) => toggleAdd(student.studentId, preset)}
                onToggleDetail={() => toggleDetail(student.studentId)}
                onOpenSheet={(focus) => setSheetStudent({ studentId: student.studentId, focus })}
                onSaved={async () => {
                  setAdding(null)
                  await load()
                }}
                onSavePeriodGrade={(periodId, patch) => savePeriodGrade(student.studentId, periodId, patch)}
              />
            )
          })}
        </ul>
      )}

      {sheetStudent && (
        <StudentSheet
          gradeBookId={gradeBookId}
          studentId={sheetStudent.studentId}
          focusSection={sheetStudent.focus}
          onClose={() => setSheetStudent(null)}
        />
      )}

      {detail.access.canGrade && !detail.access.ownWorkOnly && options && (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Importar desde Moodle
          </summary>
          <div className="mt-3">
            <MoodleImportPanel
              gradeBookId={gradeBookId}
              periods={gradablePeriods(options.periods)}
              scales={options.scales}
              defaultScaleId={options.periodScale?.id}
              onImported={() => void load()}
            />
          </div>
        </details>
      )}

    </section>
  )
}
