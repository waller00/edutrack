'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { apiBlob } from '@/lib/api/binary'
import { formatHundredths, isInsufficientHundredths } from '@/lib/academic-config/grade-value'
import {
  ACTIVITY_CATEGORY_LABEL,
  activityCategory,
  averageHundredths,
  type ActivityCategory,
} from '@/lib/gradebook/activity-category'
import {
  GRADE_1_TO_10,
  gradeSelectFromHundredths,
  gradeSelectToHundredths,
} from '@/lib/gradebook/grade-1-10'
import { libretaCode } from '@/components/libreta/MisLibretas'
import type { GradeBookDetail, GradeBookHeader, RosterStudent } from '@/lib/gradebook/types'

type ClosurePeriod = {
  periodId: string
  code: string
  name: string
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  canEdit: boolean
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
  assessmentCount: number
  valueHundredths: number | null
  conceptualJudgement: string | null
  descriptor: {
    label: string
    colorToken: string | null
    iconToken: string | null
    isAlert: boolean
  } | null
}

type ClosureSheet = {
  student: RosterStudent & { hasPhoto?: boolean }
  canGrade: boolean
  periods: ClosurePeriod[]
}

type BoardAssessment = {
  id: string
  periodId: string
  activityType: { code: string; name: string } | null
}
type BoardGrade = {
  assessmentId: string
  studentId: string
  valueHundredths: number | null
  isAbsent: boolean
}
type BoardResponse = { assessments: BoardAssessment[]; grades: BoardGrade[] }

type Draft = Record<string, { grade: string; judgement: string }>

function buildDraft(periods: ClosurePeriod[]): Draft {
  const draft: Draft = {}
  for (const period of periods) {
    draft[period.periodId] = {
      grade: gradeSelectFromHundredths(period.valueHundredths),
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

function PeriodMini({
  periodName,
  summary,
}: {
  periodName: string
  summary: Record<ActivityCategory | 'result', number | null>
}) {
  const cells: Array<{ key: string; label: string; value: number | null; highlight?: boolean }> = [
    { key: 'oral', label: ACTIVITY_CATEGORY_LABEL.oral, value: summary.oral },
    { key: 'written', label: ACTIVITY_CATEGORY_LABEL.written, value: summary.written },
    { key: 'other', label: ACTIVITY_CATEGORY_LABEL.other, value: summary.other },
    { key: 'result', label: 'R', value: summary.result, highlight: true },
  ]
  return (
    <div className="w-[14.5rem] shrink-0 overflow-hidden rounded border border-amber-200 bg-white text-[11px]">
      <p className="bg-amber-100 px-2 py-1 text-center font-semibold text-amber-950">{periodName}</p>
      <div className="grid grid-cols-4 divide-x divide-amber-100 border-t border-amber-200">
        {cells.map((cell) => {
          const display = formatHundredths(cell.value, 0)
          const insufficient = isInsufficientHundredths(cell.value)
          return (
            <div key={cell.key} className={`px-1 py-1 text-center ${cell.highlight ? 'bg-amber-50' : ''}`}>
              <p className={`font-medium ${cell.highlight ? 'text-amber-900' : 'text-slate-600'}`}>{cell.label}</p>
              {insufficient ? (
                <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-orange-100 px-1 font-medium text-orange-700 ring-1 ring-inset ring-orange-200/80">
                  {display}
                </span>
              ) : (
                <span className={cell.highlight ? 'font-semibold text-amber-950' : 'text-slate-900'}>{display}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function periodAssessmentSummary(
  grades: BoardGrade[],
  assessments: BoardAssessment[],
  periodId: string,
): Record<ActivityCategory | 'result', number | null> {
  const inPeriod = assessments.filter((a) => a.periodId === periodId)
  const byCat: Record<ActivityCategory, number[]> = { oral: [], written: [], other: [] }
  for (const assessment of inPeriod) {
    const cat = activityCategory(assessment.activityType?.code)
    for (const grade of grades) {
      if (grade.assessmentId !== assessment.id || grade.isAbsent || grade.valueHundredths == null) continue
      byCat[cat].push(grade.valueHundredths)
    }
  }
  const oral = averageHundredths(byCat.oral)
  const written = averageHundredths(byCat.written)
  const other = averageHundredths(byCat.other)
  const all = [...byCat.oral, ...byCat.written, ...byCat.other]
  return { oral, written, other, result: averageHundredths(all) }
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
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const selected = students[focusIndex] ?? null
  const courseLabel = `${detail.course.name} · ${detail.subject.name}`

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

  const dirty = useMemo(() => {
    if (!sheet) return false
    return sheet.periods.some((period) => {
      const d = draft[period.periodId]
      if (!d) return false
      const grade = gradeSelectToHundredths(d.grade)
      const judgement = d.judgement.trim() || null
      return grade !== (period.valueHundredths ?? null) || judgement !== (period.conceptualJudgement ?? null)
    })
  }, [sheet, draft])

  const visibleStudents = showAll ? students : selected ? [selected] : []

  const studentGrades = useMemo(() => {
    if (!board || !selected) return []
    return board.grades.filter((g) => g.studentId === selected.studentId)
  }, [board, selected])

  async function save() {
    if (!sheet || !selected || !dirty) return
    const entries = sheet.periods
      .filter((period) => {
        const d = draft[period.periodId]
        if (!d || !period.canEdit) return false
        const grade = gradeSelectToHundredths(d.grade)
        const judgement = d.judgement.trim() || null
        return grade !== (period.valueHundredths ?? null) || judgement !== (period.conceptualJudgement ?? null)
      })
      .map((period) => ({
        periodId: period.periodId,
        valueHundredths: gradeSelectToHundredths(draft[period.periodId]?.grade ?? ''),
        conceptualJudgement: draft[period.periodId]?.judgement.trim() || null,
      }))
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
          Cierre de promedios por alumno
        </h2>
        <p className="text-sm text-slate-600">{courseLabel}</p>
      </header>

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
                </div>

                {isFocus && periods.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {periods.map((period) => (
                      <PeriodMini
                        key={period.periodId}
                        periodName={period.name}
                        summary={periodAssessmentSummary(grades, assessments, period.periodId)}
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
                      <table className="w-full min-w-[640px] text-sm">
                        <thead className="border-b border-amber-100 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Período</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Rend.</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Juicio asignatura</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Info.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {periods.map((period) => {
                            const d = draft[period.periodId] ?? { grade: '', judgement: '' }
                            const gradeValue = gradeSelectToHundredths(d.grade)
                            const hasGrade = gradeValue != null
                            const hasJudgement = d.judgement.trim().length > 0
                            const complete =
                              (!period.requiresGeneralGrade || hasGrade) &&
                              (!period.requiresConceptualJudgement || hasJudgement)
                            const missing =
                              (period.requiresGeneralGrade && !hasGrade) ||
                              (period.requiresConceptualJudgement && !hasJudgement)
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
                                <td className="px-3 py-2">
                                  <Grade1to10Select
                                    value={d.grade}
                                    disabled={!period.canEdit || saving}
                                    onChange={(value) =>
                                      setDraft((prev) => ({
                                        ...prev,
                                        [period.periodId]: {
                                          ...prev[period.periodId],
                                          grade: value,
                                          judgement: prev[period.periodId]?.judgement ?? '',
                                        },
                                      }))
                                    }
                                    aria-label={`Rendimiento de ${period.name}`}
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <textarea
                                    value={d.judgement}
                                    disabled={!period.canEdit || saving}
                                    rows={judgementTall ? 4 : 2}
                                    onChange={(e) =>
                                      setDraft((prev) => ({
                                        ...prev,
                                        [period.periodId]: {
                                          grade: prev[period.periodId]?.grade ?? '',
                                          judgement: e.target.value,
                                        },
                                      }))
                                    }
                                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50"
                                    aria-label={`Juicio de ${period.name}`}
                                    placeholder="Juicio conceptual de la asignatura"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  {complete && !missing ? (
                                    <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="Completo" />
                                  ) : missing ? (
                                    <AlertTriangle className="h-5 w-5 text-amber-500" aria-label="Pendiente" />
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
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
    </div>
  )
}
