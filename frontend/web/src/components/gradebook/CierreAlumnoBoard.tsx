'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Printer,
  X,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { apiBlob } from '@/lib/api/binary'
import { activityCategory } from '@/lib/gradebook/activity-category'
import {
  blockCategories,
  formatGradeList,
  gradesByCategory,
  judgementLabelOf,
  periodKind,
  type PeriodKind,
} from '@/lib/gradebook/period-blocks'
import {
  GRADE_1_TO_10,
  gradeSelectFromHundredths,
  gradeSelectToHundredths,
} from '@/lib/gradebook/grade-1-10'
import { printStudentClosure } from '@/lib/gradebook/student-closure-export'
import { formatClosureStamp, periodInfoMessage } from '@/lib/gradebook/period-info'
import { libretaCode } from '@/components/libreta/MisLibretas'
import type { GradeBookDetail, GradeBookHeader, RosterStudent } from '@/lib/gradebook/types'
import PeriodBlock, { type BlockGrade } from './PeriodBlock'
import MeetingPeriodsBar from './MeetingPeriodsBar'

type ClosurePeriod = {
  periodId: string
  code: string
  name: string
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  canEdit: boolean
  kind?: PeriodKind
  isMeeting?: boolean
  judgementLabel?: string | null
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
  assessmentCount: number
  /** C: la calificación del docente. */
  valueHundredths: number | null
  /** R: la nota que queda después de la reunión. */
  meetingValueHundredths?: number | null
  conceptualJudgement: string | null
  descriptor: {
    label: string
    colorToken: string | null
    iconToken: string | null
    isAlert: boolean
  } | null
  startsOn?: string | null
  endsOn?: string | null
  closesOn?: string | null
  closedAt?: string | null
  closedLate?: boolean
  meetingJudgement?: string | null
  meetingJudgementMeta?: { createdAt: string; createdByName: string | null } | null
}

type ClosureSheet = {
  student: RosterStudent & { hasPhoto?: boolean }
  canGrade: boolean
  periods: ClosurePeriod[]
}

type BoardAssessment = {
  id: string
  periodId: string
  date: string
  title: string
  activityType: { code: string; name: string; category?: string | null } | null
}
type BoardGrade = {
  assessmentId: string
  studentId: string
  valueHundredths: number | null
  isAbsent: boolean
  comment?: string | null
}
type BoardResponse = { assessments: BoardAssessment[]; grades: BoardGrade[] }

/** Borrador por período: C, R y el texto. */
type Draft = Record<string, { grade: string; meeting: string; judgement: string }>

type InfoModal = { title: string; body: string } | null
type MeetingModal = { periodName: string; text: string; meta: string | null } | null

function buildDraft(periods: ClosurePeriod[]): Draft {
  const draft: Draft = {}
  for (const period of periods) {
    draft[period.periodId] = {
      grade: gradeSelectFromHundredths(period.valueHundredths),
      meeting: gradeSelectFromHundredths(period.meetingValueHundredths),
      judgement: period.conceptualJudgement ?? '',
    }
  }
  return draft
}

function Grade1to10Select({
  value,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="w-16 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-sm tabular-nums disabled:opacity-50"
    >
      <option value="">—</option>
      {GRADE_1_TO_10.map((n) => (
        <option key={n} value={String(n)}>
          {n}
        </option>
      ))}
      <option value="NA">N/A</option>
    </select>
  )
}

function StudentAvatar({
  gradeBookId,
  student,
}: {
  gradeBookId: string
  student: Pick<RosterStudent, 'studentId' | 'firstName' | 'lastName'> & { hasPhoto?: boolean }
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!student.hasPhoto) {
      setUrl(null)
      return
    }
    let revoked: string | null = null
    let cancelled = false
    void apiBlob(`/gradebook/${gradeBookId}/students/${student.studentId}/photo`)
      .then((blob) => {
        if (cancelled || !blob) return
        revoked = URL.createObjectURL(blob)
        setUrl(revoked)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [gradeBookId, student.studentId, student.hasPhoto])

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className="h-20 w-16 shrink-0 rounded border border-slate-200 object-cover" />
    )
  }
  const initials = `${student.lastName[0] ?? ''}${student.firstName[0] ?? ''}`.toUpperCase()
  return (
    <span
      aria-hidden
      className="flex h-20 w-16 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-600"
    >
      {initials}
    </span>
  )
}

/** Notas sueltas del alumno en un período, listas para el bloque de la planilla. */
function periodBlockGrades(grades: BoardGrade[], assessments: BoardAssessment[], periodId: string): BlockGrade[] {
  const byId = new Map(assessments.filter((a) => a.periodId === periodId).map((a) => [a.id, a]))
  return grades.flatMap((grade) => {
    const assessment = byId.get(grade.assessmentId)
    if (!assessment) return []
    return [
      {
        key: grade.assessmentId,
        category: activityCategory(assessment.activityType),
        valueHundredths: grade.valueHundredths,
        isAbsent: grade.isAbsent,
        date: assessment.date,
        title: assessment.title,
        comment: grade.comment ?? null,
      },
    ]
  })
}

/** ¿Qué cambió en el borrador de un período? Sólo eso se manda: el guardado es parcial. */
function draftPatch(period: ClosurePeriod, d: Draft[string] | undefined) {
  if (!d) return null
  const patch: { valueHundredths?: number | null; meetingValueHundredths?: number | null; conceptualJudgement?: string | null } = {}
  const grade = gradeSelectToHundredths(d.grade)
  const meeting = gradeSelectToHundredths(d.meeting)
  const judgement = d.judgement.trim() || null
  if (grade !== (period.valueHundredths ?? null)) patch.valueHundredths = grade
  if (meeting !== (period.meetingValueHundredths ?? null)) patch.meetingValueHundredths = meeting
  if (judgement !== (period.conceptualJudgement ?? null)) patch.conceptualJudgement = judgement
  return Object.keys(patch).length > 0 ? patch : null
}

/** Qué le falta al período para cerrar, según su configuración: C, R (si lleva reunión) y el texto. */
function periodCompleteness(period: ClosurePeriod, d: Draft[string]) {
  const needsMeeting = Boolean(period.isMeeting && period.requiresGeneralGrade)
  const missing =
    (period.requiresGeneralGrade && gradeSelectToHundredths(d.grade) == null) ||
    (needsMeeting && gradeSelectToHundredths(d.meeting) == null) ||
    (period.requiresConceptualJudgement && d.judgement.trim().length === 0)
  return { missing, complete: !missing }
}

function SimpleModal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="cierre-modal-title">
      <div className="responsive-modal-panel max-w-lg space-y-3">
        <header className="flex items-start justify-between gap-3">
          <h2 id="cierre-modal-title" className="text-base font-semibold uppercase tracking-wide text-slate-800">
            {title}
          </h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        {children}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-slate-100 px-4 py-1.5 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:bg-slate-200"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Cierre de promedios por alumno: carta del estudiante + calificación general y juicio por período.
 */
export default function CierreAlumnoBoard({
  gradeBookId,
  detail,
}: {
  gradeBookId: string
  detail: GradeBookDetail
}) {
  const router = useRouter()
  const students = detail.students
  const [focusIndex, setFocusIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [mine, setMine] = useState<GradeBookHeader[]>([])
  const [sheet, setSheet] = useState<ClosureSheet | null>(null)
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [judgementTall, setJudgementTall] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [infoModal, setInfoModal] = useState<InfoModal>(null)
  const [meetingModal, setMeetingModal] = useState<MeetingModal>(null)

  const selected = students[focusIndex] ?? null
  const courseLabel = `${detail.course.name} · ${detail.subject.name}`
  const libretaLabel = libretaCode(detail)

  const loadMine = useCallback(async () => {
    try {
      const res = await api<{ data: GradeBookHeader[] }>('/gradebook/mine')
      setMine(res.data ?? [])
    } catch {
      setMine([])
    }
  }, [])

  const loadStudent = useCallback(async () => {
    if (!selected) {
      setSheet(null)
      setDraft({})
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [closure, gradesBoard] = await Promise.all([
        api<ClosureSheet>(`/gradebook/${gradeBookId}/students/${selected.studentId}/closure`),
        api<BoardResponse>(`/gradebook/${gradeBookId}/grades-board`),
      ])
      setSheet(closure)
      setBoard(gradesBoard)
      setDraft(buildDraft(closure.periods))
      setError(null)
      setOkMsg(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el cierre')
      setSheet(null)
    } finally {
      setLoading(false)
    }
  }, [gradeBookId, selected])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  useEffect(() => {
    void loadStudent()
  }, [loadStudent])

  useEffect(() => {
    if (focusIndex >= students.length) setFocusIndex(Math.max(0, students.length - 1))
  }, [students.length, focusIndex])

  useEffect(() => {
    const hasPhoto = sheet?.student.hasPhoto ?? selected?.hasPhoto
    const studentId = selected?.studentId
    if (!hasPhoto || !studentId) {
      setPhotoUrl(null)
      return
    }
    let revoked: string | null = null
    let cancelled = false
    void apiBlob(`/gradebook/${gradeBookId}/students/${studentId}/photo`)
      .then((blob) => {
        if (cancelled || !blob) return
        revoked = URL.createObjectURL(blob)
        setPhotoUrl(revoked)
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl(null)
      })
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [gradeBookId, selected?.studentId, sheet?.student.hasPhoto, selected?.hasPhoto])

  const dirty = useMemo(() => {
    if (!sheet) return false
    return sheet.periods.some((period) => draftPatch(period, draft[period.periodId]) != null)
  }, [sheet, draft])

  const visibleStudents = showAll ? students : selected ? [selected] : []

  const studentGrades = useMemo(() => {
    if (!board || !selected) return []
    return board.grades.filter((g) => g.studentId === selected.studentId)
  }, [board, selected])

  async function save() {
    if (!sheet || !selected || !dirty) return
    const entries = sheet.periods.flatMap((period) => {
      const patch = period.canEdit ? draftPatch(period, draft[period.periodId]) : null
      return patch ? [{ periodId: period.periodId, ...patch }] : []
    })
    if (entries.length === 0) return

    setSaving(true)
    setOkMsg(null)
    try {
      await api(`/gradebook/${gradeBookId}/students/${selected.studentId}/closure`, {
        method: 'PUT',
        body: JSON.stringify({ entries }),
      })
      setOkMsg('Cierre guardado.')
      await loadStudent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  function cancelDraft() {
    if (sheet) setDraft(buildDraft(sheet.periods))
    setError(null)
    setOkMsg(null)
  }

  function handlePrint() {
    if (!sheet || !selected) return
    setPrintBusy(true)
    setError(null)
    try {
      const assessments = board?.assessments ?? []
      printStudentClosure({
        detail,
        student: selected,
        index: focusIndex,
        libretaLabel,
        courseLabel,
        photoUrl,
        periods: sheet.periods.map((period) => {
          const blockGrades = periodBlockGrades(studentGrades, assessments, period.periodId)
          const buckets = gradesByCategory(blockGrades)
          const categories = periodKind(period) === 'TRAMO' ? blockCategories(blockGrades) : []
          return {
            name: period.name,
            status: period.status,
            valueHundredths: gradeSelectToHundredths(draft[period.periodId]?.grade ?? '') ?? period.valueHundredths,
            meetingValueHundredths:
              gradeSelectToHundredths(draft[period.periodId]?.meeting ?? '') ?? period.meetingValueHundredths ?? null,
            judgementLabel: judgementLabelOf(period),
            conceptualJudgement: draft[period.periodId]?.judgement ?? period.conceptualJudgement,
            meetingJudgement: period.meetingJudgement ?? null,
            notes: Object.fromEntries(categories.map((cat) => [cat, formatGradeList(buckets[cat])])),
          }
        }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo imprimir')
    } finally {
      setPrintBusy(false)
    }
  }

  if (students.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
        El grupo no tiene estudiantes matriculados.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-base font-bold uppercase tracking-wide text-teal-800">
          Cierre por alumno · C y R
        </h2>
        <p className="text-sm text-slate-600">{courseLabel}</p>
        <p className="text-xs text-slate-500">
          C es la calificación que ponés vos; R, la que queda después de la reunión. La libreta no promedia.
        </p>
      </header>

      <MeetingPeriodsBar
        gradeBookId={gradeBookId}
        canClose={detail.access.canGrade}
        onClosed={() => void loadStudent()}
      />

      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-100/80 px-3 py-2 text-sm">
        <span className="font-medium text-slate-700">Libreta</span>
        <select
          value={gradeBookId}
          onChange={(e) => {
            const next = e.target.value
            if (next && next !== gradeBookId) router.push(`/libreta/${next}/cierre`)
          }}
          className="min-w-[12rem] rounded border border-slate-300 bg-white px-2 py-1.5"
          aria-label="Seleccionar libreta"
        >
          {(mine.length ? mine : [detail]).map((book) => (
            <option key={book.id} value={book.id}>
              {libretaCode(book)}
            </option>
          ))}
        </select>

        <select
          value={showAll ? 'all' : 'one'}
          onChange={(e) => setShowAll(e.target.value === 'all')}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
          aria-label="Modo de alumnos"
        >
          <option value="all">Todos los alumnos</option>
          <option value="one">Un alumno</option>
        </select>

        <select
          value={selected?.studentId ?? ''}
          onChange={(e) => {
            const idx = students.findIndex((s) => s.studentId === e.target.value)
            if (idx >= 0) {
              setFocusIndex(idx)
              setShowAll(false)
            }
          }}
          className="min-w-[14rem] flex-1 rounded border border-slate-300 bg-white px-2 py-1.5"
          aria-label="Seleccionar alumno"
        >
          {students.map((s) => (
            <option key={s.studentId} value={s.studentId}>
              {s.lastName.toUpperCase()} {s.firstName.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      {okMsg && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{okMsg}</p>
      )}

      {loading && !sheet ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando cierre…
        </p>
      ) : (
        <ul className="space-y-4">
          {visibleStudents.map((student, visIdx) => {
            const index = students.findIndex((s) => s.studentId === student.studentId)
            const n = (index >= 0 ? index : visIdx) + 1
            const isFocus = student.studentId === selected?.studentId
            const periods = isFocus ? sheet?.periods ?? [] : []
            const grades = isFocus ? studentGrades : []
            const assessments = board?.assessments ?? []

            return (
              <li
                key={student.studentId}
                className="rounded-lg border border-sky-200 bg-white p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <StudentAvatar
                    gradeBookId={gradeBookId}
                    student={{ ...student, hasPhoto: isFocus ? sheet?.student.hasPhoto : student.hasPhoto }}
                  />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-xs font-semibold text-slate-500">N.º {n}</p>
                    <p>
                      <span className="text-slate-500">Apellidos: </span>
                      <span className="font-semibold text-slate-900">{student.lastName}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Nombres: </span>
                      <span className="font-semibold text-slate-900">{student.firstName}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Documento: </span>
                      <span className="tabular-nums text-slate-800">{student.documentId ?? '—'}</span>
                    </p>
                    <p>
                      <span className="text-slate-500">Curso/Asig: </span>
                      <span className="text-slate-800">{courseLabel}</span>
                    </p>
                  </div>
                  {isFocus && (
                    <button
                      type="button"
                      disabled={printBusy || !sheet}
                      onClick={handlePrint}
                      className="inline-flex h-9 w-9 items-center justify-center rounded text-sky-700 hover:bg-sky-50 disabled:opacity-40"
                      aria-label="Imprimir cierre del alumno"
                      title="Imprimir"
                    >
                      {printBusy ? (
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                      ) : (
                        <Printer className="h-5 w-5" aria-hidden />
                      )}
                    </button>
                  )}
                </div>

                {isFocus && periods.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {periods.map((period) => (
                      <PeriodBlock
                        key={period.periodId}
                        period={{ ...period, id: period.periodId }}
                        grades={periodBlockGrades(grades, assessments, period.periodId)}
                        saved={{
                          valueHundredths: period.valueHundredths,
                          meetingValueHundredths: period.meetingValueHundredths ?? null,
                          conceptualJudgement: period.conceptualJudgement,
                        }}
                        levels={[]}
                        decimals={0}
                        status={period.status}
                        editable={false}
                      />
                    ))}
                  </div>
                )}

                {isFocus && sheet && (
                  <div className="mt-3 overflow-hidden rounded border border-amber-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-100 px-3 py-1.5">
                      <h3 className="text-sm font-semibold text-amber-950">Calificaciones y juicios</h3>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setJudgementTall(true)}
                          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-900 hover:bg-amber-50"
                        >
                          <Maximize2 className="h-3 w-3" aria-hidden />
                          Agrandar juicio
                        </button>
                        <button
                          type="button"
                          onClick={() => setJudgementTall(false)}
                          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-900 hover:bg-amber-50"
                        >
                          <Minimize2 className="h-3 w-3" aria-hidden />
                          Achicar juicio
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto bg-white">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="border-b border-amber-100 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Período</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium" title="Calificación del docente">
                              C
                            </th>
                            <th scope="col" className="px-3 py-2 text-left font-medium" title="Nota de reunión">
                              R
                            </th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Informe / juicio</th>
                            <th scope="col" className="px-3 py-2 text-center font-medium">Juicio Reu.</th>
                            <th scope="col" className="px-3 py-2 text-center font-medium">Info.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {periods.map((period) => {
                            const d = draft[period.periodId] ?? { grade: '', meeting: '', judgement: '' }
                            const { complete, missing } = periodCompleteness(period, d)
                            const judgementLabel = judgementLabelOf(period)
                            const hasGrades = periodKind(period) !== 'DIAGNOSTICO'
                            const infoText = periodInfoMessage(period)
                            const hasMeeting = Boolean(period.meetingJudgement?.trim())
                            return (
                              <tr key={period.periodId}>
                                <td className="px-3 py-2 font-medium text-slate-800">
                                  {period.name}
                                  {period.status === 'CLOSED' && (
                                    <span className="ml-2 text-[10px] font-normal uppercase text-slate-400">
                                      Cerrado
                                    </span>
                                  )}
                                </td>
                                {(['grade', 'meeting'] as const).map((field) => {
                                  const label = field === 'grade' ? `C de ${period.name}` : `R de ${period.name}`
                                  return (
                                    <td key={field} className="px-3 py-2">
                                      {hasGrades && period.canEdit ? (
                                        <Grade1to10Select
                                          value={d[field]}
                                          disabled={saving}
                                          onChange={(value) =>
                                            setDraft((prev) => ({
                                              ...prev,
                                              [period.periodId]: { ...d, ...prev[period.periodId], [field]: value },
                                            }))
                                          }
                                          aria-label={label}
                                        />
                                      ) : (
                                        <span
                                          className="inline-block min-w-[2.5rem] tabular-nums text-sm text-slate-700"
                                          aria-label={label}
                                        >
                                          {(hasGrades && d[field]) || '—'}
                                        </span>
                                      )}
                                    </td>
                                  )
                                })}
                                <td className="px-3 py-2">
                                  {period.canEdit ? (
                                    <textarea
                                      value={d.judgement}
                                      disabled={saving}
                                      rows={judgementTall ? 4 : 2}
                                      onChange={(e) =>
                                        setDraft((prev) => ({
                                          ...prev,
                                          [period.periodId]: { ...d, ...prev[period.periodId], judgement: e.target.value },
                                        }))
                                      }
                                      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                                      aria-label={`${judgementLabel} de ${period.name}`}
                                      placeholder={judgementLabel}
                                    />
                                  ) : (
                                    <p
                                      className="min-h-[2.5rem] whitespace-pre-wrap text-sm text-slate-600"
                                      aria-label={`${judgementLabel} de ${period.name}`}
                                    >
                                      {d.judgement || ''}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {hasMeeting ? (
                                    <button
                                      type="button"
                                      title="Ver juicio de reunión"
                                      aria-label={`Ver juicio de reunión de ${period.name}`}
                                      onClick={() =>
                                        setMeetingModal({
                                          periodName: period.name,
                                          text: period.meetingJudgement!.trim(),
                                          meta: period.meetingJudgementMeta
                                            ? [
                                                period.meetingJudgementMeta.createdByName,
                                                formatClosureStamp(period.meetingJudgementMeta.createdAt),
                                              ]
                                                .filter(Boolean)
                                                .join(' · ')
                                            : null,
                                        })
                                      }
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-sky-300 text-sky-700 hover:bg-sky-50"
                                    >
                                      <Info className="h-4 w-4" aria-hidden />
                                    </button>
                                  ) : (
                                    <span className="text-slate-300" title="Sin juicio de reunión cargado">
                                      —
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <button
                                    type="button"
                                    title={infoText}
                                    aria-label={`Info de ${period.name}: ${infoText}`}
                                    onClick={() =>
                                      setInfoModal({
                                        title: period.name,
                                        body: infoText,
                                      })
                                    }
                                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                                      period.status === 'CLOSED'
                                        ? 'bg-sky-600 text-white hover:bg-sky-700'
                                        : !period.canEdit
                                          ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 hover:bg-amber-50'
                                          : complete && !missing
                                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
                                            : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100'
                                    }`}
                                  >
                                    {period.status === 'CLOSED' ? (
                                      <Info className="h-4 w-4" aria-hidden />
                                    ) : !period.canEdit || missing ? (
                                      <AlertTriangle className="h-4 w-4" aria-hidden />
                                    ) : complete ? (
                                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                                    ) : (
                                      <Info className="h-4 w-4" aria-hidden />
                                    )}
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="border-t border-amber-100 bg-amber-50/50 px-3 py-1.5 text-[11px] text-slate-600">
                      <strong>C</strong> es tu calificación y <strong>R</strong> la que quedó en la reunión: el
                      boletín y la reunión usan R. El <strong>juicio de reunión</strong> lo carga administración en
                      la matriz de reunión; acá se consulta.
                    </p>
                  </div>
                )}

                {!isFocus && showAll && (
                  <button
                    type="button"
                    onClick={() => {
                      const idx = students.findIndex((s) => s.studentId === student.studentId)
                      if (idx >= 0) {
                        setFocusIndex(idx)
                        setShowAll(false)
                      }
                    }}
                    className="mt-2 text-sm font-medium text-sky-800 hover:underline"
                  >
                    Abrir cierre de este alumno
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {sheet?.canGrade && (
        <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-teal-800 disabled:opacity-40"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={cancelDraft}
            disabled={!dirty || saving}
            className="px-2 py-2 text-sm font-semibold uppercase tracking-wide text-red-600 hover:text-red-700 disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      )}

      {infoModal && (
        <SimpleModal title={infoModal.title} onClose={() => setInfoModal(null)}>
          <p className="text-sm text-slate-800">{infoModal.body}</p>
        </SimpleModal>
      )}

      {meetingModal && (
        <SimpleModal
          title={`${meetingModal.periodName} — Juicio de reunión`}
          onClose={() => setMeetingModal(null)}
        >
          <p className="whitespace-pre-wrap text-sm text-slate-800">{meetingModal.text}</p>
          {meetingModal.meta && (
            <p className="text-[11px] italic text-slate-500">{meetingModal.meta}</p>
          )}
        </SimpleModal>
      )}
    </div>
  )
}
