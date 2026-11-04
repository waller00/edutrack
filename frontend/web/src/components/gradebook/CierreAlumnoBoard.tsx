'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
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
import { useStudentPhoto } from '@/lib/hooks/useStudentPhoto'
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
  formatGrade,
  gradeSelectFromHundredths,
  gradeSelectToHundredths,
  type GradeRange,
} from '@/lib/gradebook/grade-scale'
import StudentCombobox from '@/components/forms/StudentCombobox'
import { printStudentClosure } from '@/lib/gradebook/student-closure-export'
import { formatClosureStamp, periodStatusText } from '@/lib/gradebook/period-info'
import { todayYmdUruguay } from '@/lib/libreta/absence-day'
import { libretaCode } from '@/components/libreta/MisLibretas'
import type { GradeBookDetail, RosterStudent } from '@/lib/gradebook/types'
import { useOptionalLibreta } from '@/contexts/LibretaContext'
import PeriodBlock, { type BlockGrade, type BlockLevel } from './PeriodBlock'
import MeetingClosePanel from './MeetingClosePanel'
import GradeSelect from './GradeSelect'
import ConductSelect, { conductText, type ConductOption } from './ConductSelect'
import CierreGrupoTable from './CierreGrupoTable'
import StudentHistory from './StudentHistory'
import { confirmDiscard, useUnsavedChangesWarning } from '@/lib/hooks/useUnsavedChangesWarning'
import ScrollRegion from '@/components/common/ScrollRegion'

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
  /** Calificación vieja del docente (antes de C = conducta): ya no se carga. */
  valueHundredths: number | null
  /** R: la nota que queda después de la reunión. */
  meetingValueHundredths?: number | null
  conceptualJudgement: string | null
  /** Conducta en esta asignatura (escala `CONDUCTA`), en los períodos con reunión. */
  conductValueHundredths?: number | null
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
  /** Escala del nivel: rango de C y R y tramos para el color. */
  scale?: (GradeRange & { decimals: number; levels: BlockLevel[] }) | null
  /** Opciones numéricas de conducta, del 1 al 10. */
  conduct?: ConductOption[]
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

/** Borrador por período: R (rendimiento), el texto y C (conducta), en centésimos como texto (`''` sin dato). */
type Draft = Record<string, { meeting: string; judgement: string; conduct: string }>

type MeetingModal = { periodName: string; text: string; meta: string | null } | null
type Mode = 'alumno' | 'grupo'

const DISCARD_MESSAGE = 'Hay cambios sin guardar en este cierre. ¿Descartarlos?'

function buildDraft(periods: ClosurePeriod[]): Draft {
  const draft: Draft = {}
  for (const period of periods) {
    draft[period.periodId] = {
      meeting: gradeSelectFromHundredths(period.meetingValueHundredths),
      judgement: period.conceptualJudgement ?? '',
      conduct: period.conductValueHundredths == null ? '' : String(period.conductValueHundredths),
    }
  }
  return draft
}

function StudentAvatar({
  gradeBookId,
  student,
}: {
  gradeBookId: string
  student: Pick<RosterStudent, 'studentId' | 'firstName' | 'lastName'> & { hasPhoto?: boolean }
}) {
  const url = useStudentPhoto(gradeBookId, student.studentId, student.hasPhoto)

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
  const patch: {
    meetingValueHundredths?: number | null
    conceptualJudgement?: string | null
    conductValueHundredths?: number | null
  } = {}
  const meeting = gradeSelectToHundredths(d.meeting)
  const judgement = d.judgement.trim() || null
  const conduct = d.conduct === '' ? null : Number(d.conduct)
  if (meeting !== (period.meetingValueHundredths ?? null)) patch.meetingValueHundredths = meeting
  if (judgement !== (period.conceptualJudgement ?? null)) patch.conceptualJudgement = judgement
  if (conduct !== (period.conductValueHundredths ?? null)) patch.conductValueHundredths = conduct
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * C: la nota numérica de conducta en la asignatura. Va en todo período con notas
 * (tramos y entregas), igual que en la carta; con el período cerrado se lee.
 */
function ConductCell({
  period,
  value,
  options,
  disabled,
  onChange,
}: {
  period: ClosurePeriod
  value: string
  options: readonly ConductOption[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  if (periodKind(period) === 'DIAGNOSTICO') return <span className="text-slate-300">—</span>
  if (!period.canEdit) {
    return (
      <span className="text-sm text-slate-700" aria-label={`C (conducta) de ${period.name}`}>
        {conductText(value === '' ? null : Number(value), options)}
      </span>
    )
  }
  return (
    <ConductSelect
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      aria-label={`C (conducta) de ${period.name}`}
    />
  )
}

/** Qué le falta al período para cerrar, según su configuración: R, C (si lleva reunión) y el texto. */
function periodCompleteness(period: ClosurePeriod, d: Draft[string]) {
  const needsConduct = Boolean(period.isMeeting && period.requiresGeneralGrade)
  const missing =
    (period.requiresGeneralGrade && gradeSelectToHundredths(d.meeting) == null) ||
    (needsConduct && d.conduct === '') ||
    (period.requiresConceptualJudgement && d.judgement.trim().length === 0)
  return { missing }
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
  // Un aviso de «falta completar» trae la reunión: el panel y la tabla del grupo abren en ella.
  const requestedPeriodId = useSearchParams()?.get('periodId') ?? null
  const students = detail.students
  const [focusIndex, setFocusIndex] = useState(0)
  // Abre en todo el grupo: es la forma de cerrar una reunión. La carta es para mirar a uno solo.
  const [mode, setMode] = useState<Mode>('grupo')
  const [groupDirty, setGroupDirty] = useState(false)
  // Desde el panel, "Ir al informe del grupo" o "la tabla del grupo" saltan a una reunión: la tabla
  // se vuelve a montar en ese período aunque ya estuviera abierta en otro.
  const [groupJump, setGroupJump] = useState<{ periodId: string | null; n: number }>({ periodId: requestedPeriodId, n: 0 })
  // Cambia al guardar: el panel vuelve a contar lo que falta para cerrar.
  const [refreshKey, setRefreshKey] = useState(0)
  const [sheet, setSheet] = useState<ClosureSheet | null>(null)
  const [board, setBoard] = useState<BoardResponse | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [judgementTall, setJudgementTall] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [meetingModal, setMeetingModal] = useState<MeetingModal>(null)

  const selected = students[focusIndex] ?? null
  const courseLabel = `${detail.course.name} · ${detail.subject.name}`
  const libretaLabel = libretaCode(detail)


  // Las notas de toda la libreta se piden una vez, no cada vez que se cambia de alumno.
  useEffect(() => {
    let cancelled = false
    void api<BoardResponse>(`/gradebook/${gradeBookId}/grades-board`)
      .then((res) => {
        if (!cancelled) setBoard(res)
      })
      .catch(() => {
        if (!cancelled) setBoard(null)
      })
    return () => {
      cancelled = true
    }
  }, [gradeBookId])

  const loadStudent = useCallback(async () => {
    if (!selected) {
      setSheet(null)
      setDraft({})
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const closure = await api<ClosureSheet>(`/gradebook/${gradeBookId}/students/${selected.studentId}/closure`)
      setSheet(closure)
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
    void loadStudent()
  }, [loadStudent])

  useEffect(() => {
    if (focusIndex >= students.length) setFocusIndex(Math.max(0, students.length - 1))
  }, [students.length, focusIndex])

  // La misma foto que la tarjeta, para imprimir: el hook la pide una sola vez.
  const photoUrl = useStudentPhoto(gradeBookId, selected?.studentId, sheet?.student.hasPhoto ?? selected?.hasPhoto)

  const dirty = useMemo(() => {
    if (!sheet) return false
    return sheet.periods.some((period) => draftPatch(period, draft[period.periodId]) != null)
  }, [sheet, draft])

  // Antes cambiar de alumno o de libreta tiraba lo cargado sin avisar.
  useUnsavedChangesWarning(dirty)
  const unsaved = mode === 'grupo' ? groupDirty : dirty
  // El selector de grupo de la libreta pregunta antes de irse con cambios sin guardar.
  const setLeaveGuard = useOptionalLibreta()?.setLeaveGuard
  useEffect(() => {
    setLeaveGuard?.({ dirty: unsaved, message: DISCARD_MESSAGE })
    return () => setLeaveGuard?.(null)
  }, [setLeaveGuard, unsaved])

  function selectStudent(studentId: string) {
    const idx = students.findIndex((s) => s.studentId === studentId)
    if (idx < 0 || idx === focusIndex || !confirmDiscard(dirty, DISCARD_MESSAGE)) return
    setFocusIndex(idx)
  }

  /** La carta de un alumno (o la del que estaba elegido), sin tirar lo que no se guardó. */
  function showStudent(studentId?: string) {
    if (mode === 'alumno') {
      if (studentId) selectStudent(studentId)
      return
    }
    if (!confirmDiscard(unsaved, DISCARD_MESSAGE)) return
    setMode('alumno')
    setGroupDirty(false)
    const idx = studentId ? students.findIndex((s) => s.studentId === studentId) : -1
    if (idx >= 0) setFocusIndex(idx)
  }

  /** La tabla de todo el grupo; con `periodId`, abierta en esa reunión. */
  function showGroup(periodId?: string) {
    if (!confirmDiscard(unsaved, DISCARD_MESSAGE)) return
    setMode('grupo')
    setGroupDirty(false)
    if (periodId) setGroupJump((jump) => ({ periodId, n: jump.n + 1 }))
  }

  const visibleStudents = selected ? [selected] : []

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
      setRefreshKey((key) => key + 1)
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
            conductLabel: conductText(
              draft[period.periodId]?.conduct ? Number(draft[period.periodId].conduct) : period.conductValueHundredths ?? null,
              sheet.conduct ?? [],
            ),
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
          Cierre de períodos · C y R
        </h2>
        <p className="text-sm text-slate-600">{courseLabel}</p>
        <p className="text-xs text-slate-500">
          C es la conducta y R el rendimiento, la nota que va al boletín. La libreta no promedia.
        </p>
      </header>

      <MeetingClosePanel
        gradeBookId={gradeBookId}
        canClose={detail.access.canGrade}
        refreshKey={refreshKey}
        initialPeriodId={requestedPeriodId}
        onChanged={() => void loadStudent()}
        onPickStudent={(studentId) => showStudent(studentId)}
        onOpenGroup={(periodId) => showGroup(periodId)}
      />

      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-100/80 px-3 py-2 text-sm">
        {/* Las dos vistas a la vista: "Todo el grupo" estaba escondido como primera opción del
            buscador de alumnos. */}
        <div role="group" aria-label="Vista del cierre" className="inline-flex overflow-hidden rounded border border-slate-300 bg-white">
          {(
            [
              ['grupo', 'Todo el grupo'],
              ['alumno', 'Alumno por alumno'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => (value === 'grupo' ? showGroup() : showStudent())}
              className={`px-3 py-1.5 text-sm font-medium ${
                mode === value ? 'bg-teal-700 text-white' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'alumno' && (
          <StudentCombobox
            students={students}
            value={selected?.studentId ?? null}
            numbered
            label="Alumno"
            hideLabel
            disabled={students.length === 0}
            className="min-w-[16rem] flex-1"
            onChange={(studentId) => {
              if (studentId) selectStudent(studentId)
            }}
          />
        )}
      </div>

      {mode === 'grupo' && (
        <CierreGrupoTable
          key={`${groupJump.periodId ?? 'en-curso'}-${groupJump.n}`}
          gradeBookId={gradeBookId}
          initialPeriodId={groupJump.periodId ?? undefined}
          onDirtyChange={setGroupDirty}
          onSaved={() => setRefreshKey((key) => key + 1)}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      {okMsg && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{okMsg}</p>
      )}

      {mode === 'alumno' && loading && !sheet && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando cierre…
        </p>
      )}
      {mode === 'alumno' && !(loading && !sheet) && (
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
                {/* En pantallas anchas, los datos a la izquierda y los períodos a la derecha: apilados, la
                    carta quedaba apaisada con el costado derecho vacío. */}
                <div className={`grid gap-3 lg:items-start ${isFocus && periods.length > 0 ? 'lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]' : ''}`}>
                  <div className="flex items-start gap-3">
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
                    <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] items-start gap-3">
                      {periods.map((period) => (
                        <PeriodBlock
                          key={period.periodId}
                          period={{ ...period, id: period.periodId }}
                          grades={periodBlockGrades(grades, assessments, period.periodId)}
                          saved={{
                            meetingValueHundredths: period.meetingValueHundredths ?? null,
                            conductValueHundredths: period.conductValueHundredths ?? null,
                            conceptualJudgement: period.conceptualJudgement,
                          }}
                          conduct={sheet?.conduct ?? []}
                          levels={sheet?.scale?.levels ?? []}
                          decimals={sheet?.scale?.decimals ?? 0}
                          status={period.status}
                          editable={false}
                        />
                      ))}
                    </div>
                  )}
                </div>

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

                    <ScrollRegion label="Calificaciones y juicios" className="overflow-x-auto bg-white">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="border-b border-amber-100 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Período</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium" title="Conducta en la asignatura">
                              C · Conducta
                            </th>
                            <th scope="col" className="px-3 py-2 text-left font-medium" title="Rendimiento: la nota del boletín">
                              R · Rendimiento
                            </th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Informe / juicio</th>
                            <th scope="col" className="px-3 py-2 text-center font-medium">Juicio de la reunión</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {periods.map((period) => {
                            const d = draft[period.periodId] ?? { meeting: '', judgement: '', conduct: '' }
                            const { missing } = periodCompleteness(period, d)
                            const judgementLabel = judgementLabelOf(period)
                            const hasGrades = periodKind(period) !== 'DIAGNOSTICO'
                            const statusText = periodStatusText(period, todayYmdUruguay())
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
                                <td className="px-3 py-2">
                                  <ConductCell
                                    period={period}
                                    value={d.conduct}
                                    options={sheet.conduct ?? []}
                                    disabled={saving}
                                    onChange={(value) =>
                                      setDraft((prev) => ({
                                        ...prev,
                                        [period.periodId]: { ...d, ...prev[period.periodId], conduct: value },
                                      }))
                                    }
                                  />
                                </td>
                                {(['meeting'] as const).map((field) => {
                                  const label = `R (rendimiento) de ${period.name}`
                                  return (
                                    <td key={field} className="px-3 py-2">
                                      {hasGrades && period.canEdit ? (
                                        <GradeSelect
                                          value={d[field]}
                                          scale={sheet.scale}
                                          className="w-16 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-sm tabular-nums disabled:opacity-50"
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
                                          {hasGrades ? formatGrade(gradeSelectToHundredths(d[field])) : '—'}
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
                                <td className="px-3 py-2 text-xs">
                                  {/* En palabras: antes era un ícono cuyo color había que adivinar. */}
                                  <span className="text-slate-700">{statusText}</span>
                                  {period.status !== 'CLOSED' && period.canEdit && (
                                    <span className={`mt-0.5 flex items-center gap-1 ${missing ? 'text-amber-800' : 'text-emerald-700'}`}>
                                      {missing ? (
                                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                                      ) : (
                                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                                      )}
                                      {/* Mira C, R y juicio de este alumno; las notas del tramo las cuenta el panel de arriba. */}
                                      {missing ? 'Falta C, R o juicio' : 'C, R y juicio cargados'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </ScrollRegion>
                    <p className="border-t border-amber-100 bg-amber-50/50 px-3 py-1.5 text-[11px] text-slate-600">
                      <strong>C</strong> es la conducta y <strong>R</strong> el rendimiento: el boletín y la reunión
                      usan R. El <strong>juicio de reunión</strong> lo carga administración en la matriz de reunión;
                      acá se consulta.
                    </p>
                  </div>
                )}

                {isFocus && sheet && (
                  <div className="mt-3">
                    <StudentHistory key={student.studentId} gradeBookId={gradeBookId} studentId={student.studentId} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {mode === 'alumno' && sheet?.canGrade && (
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
