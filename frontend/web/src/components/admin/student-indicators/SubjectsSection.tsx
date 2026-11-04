'use client'

import Link from 'next/link'
import StatTile from '@/components/common/StatTile'
import { PartsList, SegmentedBar } from '@/components/charts/SegmentedBar'
import { ACCENT_COLOR, subjectRanking, type CourseRanking, type LowGradesResponse } from '@/lib/admin/student-indicators'
import { apeParts, focusNote, type SubjectsApeResponse } from '@/lib/admin/student-trajectory'
import { formatCount, formatShare, ratioValue } from '@/lib/format/percent'
import { useIndicatorData } from './indicator-data'
import { EmptyNote, LoadState, Panel, Table, type IndicatorContext } from './parts'

function ShareBar({ part, total }: Readonly<{ part: number; total: number }>) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${ratioValue(part, total) ?? 0}%`, background: ACCENT_COLOR }} />
      </span>
      <span className="tabular-nums">{formatShare(part, total)}</span>
    </span>
  )
}

function CourseCard({ course }: Readonly<{ course: CourseRanking }>) {
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{course.courseName}</h4>
        <p className="text-xs text-slate-500">
          {formatShare(course.low, course.graded)} estudiantes con alguna materia baja
        </p>
      </div>
      {course.subjects.length === 0 ? (
        <p className="text-sm text-slate-500">Ninguna materia con notas bajas.</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {course.subjects.map((subject) => (
            <li key={`${subject.subjectName}-${subject.orientationName}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <span className="truncate text-slate-800" title={subject.subjectName}>
                {subject.subjectName}
                {subject.orientationName ? <span className="text-slate-500"> · {subject.orientationName}</span> : null}
              </span>
              <ShareBar part={subject.low} total={subject.graded} />
            </li>
          ))}
        </ol>
      )}
      {course.hidden > 0 && <p className="text-xs text-slate-500">y {course.hidden} materias más con alguna nota baja.</p>}
    </li>
  )
}

function Ranking({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const lowGrades = useIndicatorData<LowGradesResponse>(ctx.paths.lowGrades)
  const body = () => {
    if (!ctx.paths.lowGrades) return <EmptyNote>{ctx.periodsReady ? 'El ciclo todavía no tiene boletines.' : 'Buscando los boletines del ciclo…'}</EmptyNote>
    if (!lowGrades.data) return <LoadState state={lowGrades} what="las notas bajas" />
    if (lowGrades.data.rows.length === 0) return <EmptyNote>No hay libretas para este boletín.</EmptyNote>
    return (
      <ul className="grid gap-3 lg:grid-cols-2">
        {subjectRanking(lowGrades.data).map((course) => (
          <CourseCard key={course.courseOfferingId} course={course} />
        ))}
      </ul>
    )
  }
  return (
    <Panel
      title="Materias con más notas bajas, por curso"
      description="Estudiantes con nota baja (tramo de alerta de la escala) sobre los que ya tienen la R de esa materia en el boletín."
    >
      {body()}
    </Panel>
  )
}

function ApeSummary({ data }: Readonly<{ data: SubjectsApeResponse }>) {
  const note = focusNote(data.requestedYear, data.focusYear, 'todavía no tiene materias que hayan ido a APE')
  const totals = data.byCourse.reduce(
    (acc, row) => ({
      referred: acc.referred + row.referred,
      december: acc.december + row.december,
      february: acc.february + row.february,
      previa: acc.previa + row.previa,
      owed: acc.owed + row.owed,
    }),
    { referred: 0, december: 0, february: 0, previa: 0, owed: 0 },
  )
  const parts = apeParts(totals)
  const { students } = data
  return (
    <Panel
      title={`Qué pasó con las materias que fueron a APE (${data.focusYear?.label ?? ''})`}
      description="Las materias que cada estudiante perdió al cerrar el año: si las salvó en la APE de diciembre, en la de febrero, después como previa, o si todavía las debe."
    >
      {note && <p className="text-xs text-slate-600">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Estudiantes que fueron a APE" value={formatCount(students.referred)} detail={`Con ${formatCount(totals.referred)} materias perdidas en total.`} />
        <StatTile
          label="Salvaron todo antes de marzo"
          value={formatCount(students.clearedByFebruary)}
          detail={`${formatShare(students.clearedByFebruary, students.referred)} de los que fueron.`}
        />
        <StatTile
          label="Siguen debiendo"
          value={formatCount(students.stillOwing)}
          detail={`${formatShare(students.stillOwing, students.referred)}; ${students.clearedLater} salvaron después, como previa.`}
          tone={students.stillOwing > 0 ? 'warning' : 'neutral'}
        />
      </div>
      <SegmentedBar parts={parts} label="Materias que fueron a APE" />
      <PartsList parts={parts} unit="materias" />
      <Table head={['Curso', 'Materia', 'Fueron a APE', 'Diciembre', 'Febrero', 'Después', 'La deben']} minWidth={640}>
        {data.rows.map((row) => (
          <tr key={`${row.courseId}-${row.subjectId}`}>
            <td className="px-3 py-1.5">{row.courseName}</td>
            <td className="px-3 py-1.5">{row.subjectName}</td>
            <td className="px-3 py-1.5 tabular-nums">{row.referred}</td>
            <td className="px-3 py-1.5 tabular-nums">{row.december}</td>
            <td className="px-3 py-1.5 tabular-nums">{row.february}</td>
            <td className="px-3 py-1.5 tabular-nums">{row.previa}</td>
            <td className="px-3 py-1.5 tabular-nums">{row.owed > 0 ? <strong className="text-amber-900">{row.owed}</strong> : 0}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

function Ape({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const ape = useIndicatorData<SubjectsApeResponse>(ctx.paths.subjectsApe)
  if (!ape.data) return <LoadState state={ape} what="las materias y la APE" />
  const { carriedOver } = ape.data
  return (
    <>
      {ape.data.focusYear ? (
        <ApeSummary data={ape.data} />
      ) : (
        <Panel title="Materias que fueron a APE">
          <EmptyNote>Todavía no hay materias perdidas registradas en ningún ciclo.</EmptyNote>
        </Panel>
      )}
      <Panel title="Materias de años anteriores" description="Estudiantes de este ciclo que, al empezarlo, debían materias de años anteriores.">
        <p className="text-sm text-slate-700">
          {carriedOver.students === 0
            ? 'Nadie empezó el ciclo debiendo materias.'
            : `${formatCount(carriedOver.students)} estudiantes empezaron el ciclo debiendo ${formatCount(carriedOver.subjects)} materias.`}
        </p>
        {carriedOver.students > 0 && (
          <Link href={ctx.sectionHref({ seccion: 'riesgo', motivo: 'notas' })} className="text-sm font-medium text-emerald-700 hover:underline">
            Ver quiénes en Quién necesita atención →
          </Link>
        )}
      </Panel>
    </>
  )
}

/** Dónde se concentran las notas bajas del boletín, y qué pasó con las materias que se perdieron. */
export default function SubjectsSection({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  return (
    <div className="space-y-5">
      <Ranking ctx={ctx} />
      <Ape ctx={ctx} />
    </div>
  )
}
