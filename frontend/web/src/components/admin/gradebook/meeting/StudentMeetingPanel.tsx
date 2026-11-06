'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from 'lucide-react'
import SidePanel from '@/components/common/SidePanel'
import { confirmDiscard } from '@/lib/hooks/useUnsavedChangesWarning'
import { formatGrade } from '@/lib/gradebook/grade-scale'
import { averageHint, studentName, subjectStatus, type MeetingField } from '@/lib/gradebook/meeting-board'
import {
  assessmentResult,
  gradeChange,
  schoolAbsenceSummary,
  shortDate,
  subjectAbsenceDetail,
  subjectAbsenceSummary,
  subjectCounts,
  type MeetingStudent,
  type MeetingStudentSubject,
} from '@/lib/gradebook/meeting-student'
import { JudgementEditor } from '../MeetingDecisions'
import { ConductInput, GradeBadge, PerformanceInput } from './cells'
import { saveKey } from './MatrixTable'
import type { Matrix, MatrixRow, SaveStatus } from './types'
import type { MeetingRecords } from './useMeetingRecords'
import type { MeetingStudentDetail } from './useMeetingStudent'

const TITLE_ID = 'panel-alumno-titulo'
const subjectAnchor = (gradeBookId: string) => `panel-materia-${gradeBookId}`

const CHANGE_CLASS = { up: 'text-emerald-800', down: 'text-red-800', same: 'text-gray-600' } as const

export type StudentMeetingPanelProps = {
  open: boolean
  row: MatrixRow | null
  /** N.º de lista. */
  number?: number
  detail: MeetingStudentDetail
  onRetry: () => void
  /** La materia que se tocó en la matriz: abre desplegada y a la vista. */
  focusGradeBookId: string | null
  previous: MatrixRow | null
  next: MatrixRow | null
  onNavigate: (studentId: string) => void
  onClose: () => void
  matrix: Matrix
  canEdit: boolean
  saves: Readonly<Record<string, SaveStatus>>
  onSave: (field: MeetingField, row: MatrixRow, value: number | null) => void
  records: MeetingRecords
  fichaHref: string
  projection: boolean
  groupLabel: string
}

/**
 * El alumno en la reunión: lo que decide la reunión (rendimiento, conducta, juicio) con lo que
 * hace falta para decidirlo al lado —cada materia con su detalle y las faltas del liceo— y
 * «Anterior / Siguiente» para recorrer la lista como se hace en la reunión.
 */
export default function StudentMeetingPanel(props: Readonly<StudentMeetingPanelProps>) {
  const { open, row, onClose, onNavigate, projection } = props
  const closeRef = useRef<HTMLButtonElement>(null)
  // Un juicio a medio escribir no se pierde sin avisar: «Siguiente», Escape o cerrar lo descartaban.
  const unsaved = useRef(false)
  const confirmLeave = () =>
    confirmDiscard(unsaved.current, `El juicio de ${row ? studentName(row) : 'este alumno'} no está guardado. ¿Salir sin guardarlo?`)
  const guarded = {
    ...props,
    onClose: () => confirmLeave() && onClose(),
    onNavigate: (studentId: string) => confirmLeave() && onNavigate(studentId),
  }
  return (
    <SidePanel open={open && row !== null} onClose={guarded.onClose} labelledBy={TITLE_ID} initialFocusRef={closeRef} widthClass="max-w-2xl">
      {row && (
        <div className={`flex min-h-0 flex-1 flex-col ${projection ? 'text-base' : 'text-sm'}`}>
          <PanelHeader {...guarded} row={row} closeRef={closeRef} />
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
            <DecideSection {...guarded} row={row} onJudgementDirty={(dirty) => (unsaved.current = dirty)} />
            <PanelBody {...guarded} />
          </div>
        </div>
      )}
    </SidePanel>
  )
}

function PanelHeader({
  row,
  number,
  detail,
  previous,
  next,
  onNavigate,
  onClose,
  fichaHref,
  groupLabel,
  closeRef,
}: Readonly<StudentMeetingPanelProps & { row: MatrixRow; closeRef: RefObject<HTMLButtonElement> }>) {
  const counts = detail.status === 'ready' ? subjectCounts(detail.data.subjects) : null
  return (
    <header className="shrink-0 space-y-2 border-b border-gray-100 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">
            {number != null && `N.º ${number} · `}
            {groupLabel}
            {detail.status === 'ready' && ` · ${detail.data.period.name}`}
          </p>
          <h2 id={TITLE_ID} className="text-lg font-semibold text-gray-900">
            {studentName(row)}
          </h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          aria-label="Cerrar el panel del alumno"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        {row.atRisk && (
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-medium text-red-800">
            <span aria-hidden>▲ </span>
            {row.alertCount} en alerta
          </span>
        )}
        {counts && counts.declined > 0 && (
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-900">
            <span aria-hidden>↓ </span>
            bajó en {counts.declined} {counts.declined === 1 ? 'materia' : 'materias'}
          </span>
        )}
        {row.pendingCount > 0 && <span className="text-gray-600">{row.pendingCount} sin R</span>}
      </p>
      <nav aria-label="Recorrer la lista" className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!previous}
          onClick={() => previous && onNavigate(previous.studentId)}
          aria-label={previous ? `Anterior: ${studentName(previous)}` : 'No hay anterior'}
          className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-sm disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Anterior
        </button>
        <Link href={fichaHref} className="inline-flex items-center gap-1 text-sm text-emerald-800 hover:underline">
          Ficha completa
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <button
          type="button"
          disabled={!next}
          onClick={() => next && onNavigate(next.studentId)}
          aria-label={next ? `Siguiente: ${studentName(next)}` : 'No hay siguiente'}
          className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-sm disabled:opacity-40"
        >
          Siguiente
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </nav>
    </header>
  )
}

/** Rendimiento, conducta y juicio: lo mismo que la tabla y «Juicios de la reunión». */
function DecideSection({
  row,
  matrix,
  canEdit,
  saves,
  onSave,
  records,
  onJudgementDirty,
}: Readonly<StudentMeetingPanelProps & { row: MatrixRow; onJudgementDirty: (dirty: boolean) => void }>) {
  const name = studentName(row)
  return (
    <section aria-labelledby="panel-decide" className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
      <h3 id="panel-decide" className="text-sm font-semibold text-gray-900">
        Decide la reunión
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-600">Rendimiento</p>
          <PerformanceInput
            row={row}
            scale={matrix.performanceScale ?? null}
            editable={canEdit}
            status={saves[saveKey('performance', row.studentId)]}
            onChange={(value) => onSave('performance', row, value)}
          />
          <p className="text-[11px] text-gray-500">
            {averageHint(row.averageHundredths, matrix.averageDecimals ?? 1) ?? 'Sin promedio todavía'} · referencia
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-600">Conducta</p>
          <ConductInput
            row={row}
            levels={matrix.conductLevels ?? []}
            editable={canEdit}
            status={saves[saveKey('conduct', row.studentId)]}
            onChange={(value) => onSave('conduct', row, value)}
          />
          <p className="text-[11px] text-gray-500">La carga adscripción, para todo el liceo.</p>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-600">Juicio · va a su boletín</p>
        {records.loading ? (
          <p className="text-sm text-gray-500">Cargando el juicio…</p>
        ) : (
          <JudgementEditor
            key={row.studentId}
            of={`de ${name}`}
            current={records.current.get(row.studentId)}
            canWrite={canEdit}
            onSave={(text) => records.save(row.studentId, text)}
            onDirtyChange={onJudgementDirty}
          />
        )}
        {records.error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {records.error}
          </p>
        )}
      </div>
    </section>
  )
}

function PanelBody({ detail, onRetry, focusGradeBookId, row }: Readonly<StudentMeetingPanelProps>) {
  if (detail.status === 'error') {
    return (
      <div role="alert" className="space-y-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        <p>No se pudo cargar el detalle del alumno. {detail.error}</p>
        <button type="button" onClick={onRetry} className="btn-secondary text-sm">
          Reintentar
        </button>
      </div>
    )
  }
  if (detail.status !== 'ready') {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando las materias y las faltas…
      </p>
    )
  }
  return (
    <>
      <SchoolAbsences data={detail.data} />
      <SubjectList key={row?.studentId} data={detail.data} focusGradeBookId={focusGradeBookId} />
    </>
  )
}

/** Las faltas del liceo como el boletín: por día, con el desglose. */
function SchoolAbsences({ data }: Readonly<{ data: MeetingStudent }>) {
  const summary = schoolAbsenceSummary(data.absences)
  return (
    <section aria-labelledby="panel-faltas" className="space-y-1">
      <h3 id="panel-faltas" className="text-sm font-semibold text-gray-900">
        Faltas del liceo <span className="font-normal text-gray-500">· en el ciclo, hasta hoy</span>
      </h3>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold text-gray-900">{summary.total}</span>
        <span className="text-gray-700">faltas</span>
        <span className="text-xs text-gray-500">· en el boletín: {summary.reportCard}</span>
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-gray-700">
        {summary.parts.map((part) => (
          <li key={part.label}>
            <span className="font-medium">{part.count}</span> {part.label}
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-500">
        Cuentan por día, como en el boletín: una justificada o una llegada tarde valen media falta.
      </p>
    </section>
  )
}

function SubjectList({ data, focusGradeBookId }: Readonly<{ data: MeetingStudent; focusGradeBookId: string | null }>) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusGradeBookId ? [focusGradeBookId] : []))
  const allOpen = data.subjects.length > 0 && data.subjects.every((s) => expanded.has(s.gradeBookId))

  // La materia que se tocó en la matriz queda desplegada y a la vista.
  useEffect(() => {
    if (!focusGradeBookId) return
    setExpanded((prev) => new Set(prev).add(focusGradeBookId))
    requestAnimationFrame(() =>
      document.getElementById(subjectAnchor(focusGradeBookId))?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }),
    )
  }, [focusGradeBookId])

  function toggle(id: string) {
    setExpanded((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(id)) nextSet.delete(id)
      else nextSet.add(id)
      return nextSet
    })
  }

  return (
    <section aria-labelledby="panel-materias" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="panel-materias" className="text-sm font-semibold text-gray-900">
          Materias{' '}
          <span className="font-normal text-gray-500">
            · {data.period.name}
            {data.previousPeriod && `, comparada con ${data.previousPeriod.name}`}
          </span>
        </h3>
        <button
          type="button"
          onClick={() => setExpanded(allOpen ? new Set() : new Set(data.subjects.map((s) => s.gradeBookId)))}
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          {allOpen ? 'Plegar todas' : 'Desplegar todas'}
        </button>
      </div>
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {data.subjects.map((subject) => (
          <SubjectItem
            key={subject.gradeBookId}
            subject={subject}
            data={data}
            open={expanded.has(subject.gradeBookId)}
            onToggle={() => toggle(subject.gradeBookId)}
          />
        ))}
      </ul>
      <p className="text-xs text-gray-500">
        Las faltas de cada materia cuentan cada clase una vez: sirven para seguir la materia, no son las del boletín.
      </p>
    </section>
  )
}

function SubjectItem({
  subject,
  data,
  open,
  onToggle,
}: Readonly<{ subject: MeetingStudentSubject; data: MeetingStudent; open: boolean; onToggle: () => void }>) {
  const change = gradeChange(subject.previousValueHundredths, subject.valueHundredths)
  const status = subjectStatus(subject.periodStatus)
  const detailId = `${subjectAnchor(subject.gradeBookId)}-detalle`
  return (
    <li id={subjectAnchor(subject.gradeBookId)} className="scroll-mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50"
      >
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-gray-900">{subject.name}</span>
          <span className="block text-xs text-gray-500">
            {subject.teacher ?? 'Sin docente'}
            {subject.periodStatus !== 'CLOSED' && ` · ${status.symbol} ${status.label}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <GradeBadge
            valueHundredths={subject.valueHundredths}
            descriptor={subject.descriptor}
            proposedValueHundredths={subject.proposedValueHundredths}
            showLabel
          />
          {change && (
            <span className={CHANGE_CLASS[change.direction]}>
              <span aria-hidden>{change.symbol} </span>
              {change.word} {change.text}
            </span>
          )}
          <span className="text-gray-500">{subjectAbsenceSummary(subject.attendance.period ?? subject.attendance.year)}</span>
        </span>
      </button>
      {open && <SubjectDetail id={detailId} subject={subject} data={data} />}
    </li>
  )
}

function SubjectDetail({ id, subject, data }: Readonly<{ id: string; subject: MeetingStudentSubject; data: MeetingStudent }>) {
  return (
    <div id={id} className="space-y-3 border-t border-gray-100 bg-gray-50/70 px-3 py-3 pl-9">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Evaluaciones del período</h4>
        {subject.assessments.length === 0 ? (
          <p className="text-gray-500">Sin evaluaciones en los tramos que informa la reunión.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {subject.assessments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs tabular-nums text-gray-500">{shortDate(a.date)}</span>
                <span className="text-gray-800">{a.title}</span>
                <span className="text-xs text-gray-500">
                  {a.periodName}
                  {a.scope === 'INDIVIDUAL' && ' · individual'}
                </span>
                <span className={`ml-auto font-medium ${a.isAbsent || a.missing ? 'text-amber-900' : 'text-gray-900'}`}>
                  {assessmentResult(a)}
                </span>
                {a.comment && <span className="w-full text-xs text-gray-600">«{a.comment}»</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">C · conducta en la materia</dt>
          <dd className="text-gray-900">{formatGrade(subject.conductValueHundredths)}</dd>
        </div>
        {data.previousPeriod && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">R en {data.previousPeriod.name}</dt>
            <dd className="text-gray-900">{formatGrade(subject.previousValueHundredths)}</dd>
          </div>
        )}
      </dl>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Juicio del docente</h4>
        <p className={`whitespace-pre-line ${subject.conceptualJudgement ? 'text-gray-800' : 'text-gray-500'}`}>
          {subject.conceptualJudgement ?? 'Sin juicio'}
        </p>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Faltas a esta materia</h4>
        {subject.attendance.period && (
          <p className="text-gray-800">
            En {data.period.name}: {subjectAbsenceDetail(subject.attendance.period)}
          </p>
        )}
        <p className="text-gray-800">En el año: {subjectAbsenceDetail(subject.attendance.year)}</p>
      </div>
    </div>
  )
}
