'use client'

import StatTile from '@/components/common/StatTile'
import { PartsList, SegmentedBar } from '@/components/charts/SegmentedBar'
import {
  cohortLabel,
  cohortParts,
  focusNote,
  outcomeParts,
  trajectoryHeadline,
  type Cohort,
  type TrajectoryResponse,
} from '@/lib/admin/student-trajectory'
import { formatCount, formatRatio, formatShare } from '@/lib/format/percent'
import { useIndicatorData } from './indicator-data'
import { EmptyNote, LoadState, Panel, Table, type IndicatorContext } from './parts'

function Headline({ data }: Readonly<{ data: TrajectoryResponse }>) {
  const h = trajectoryHeadline(data.total, data.byCourse)
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Promovieron"
        value={formatRatio(h.promoted, h.enrolled)}
        detail={`${formatShare(h.promoted, h.enrolled)} matriculados; ${h.promotedWithPending} con materias pendientes.`}
      />
      <StatTile label="Repitieron" value={formatRatio(h.repeated, h.enrolled)} detail={`${formatShare(h.repeated, h.enrolled)} matriculados.`} />
      <StatTile
        label="Egresaron"
        value={formatRatio(h.graduated, h.finalEnrolled)}
        detail={`${formatShare(h.graduated, h.finalEnrolled)} matriculados en el último grado.`}
      />
      <StatTile
        label="Dejaron el liceo"
        value={formatRatio(h.left, h.enrolled)}
        detail={`${formatShare(h.left, h.enrolled)} matriculados: ${h.leftDuringYear} en el año y ${h.notReenrolled} que no se reinscribieron.`}
      />
    </div>
  )
}

function ByCourse({ data }: Readonly<{ data: TrajectoryResponse }>) {
  return (
    <Panel
      title="Cómo terminó el año, por curso"
      description="El fallo de cada estudiante: el que se cargó o, si falta, el que muestra su matrícula del año siguiente (mismo grado es que repitió)."
    >
      <Table head={['Curso', 'Matriculados', 'Cómo terminó', 'No se reinscribieron']} minWidth={720}>
        {data.byCourse.map((row) => {
          const parts = outcomeParts(row)
          return (
            <tr key={row.courseId}>
              <th scope="row" className="px-3 py-2 text-left align-top font-medium text-slate-900">
                {row.courseName}
              </th>
              <td className="px-3 py-2 align-top tabular-nums">{formatCount(row.enrolled)}</td>
              <td className="space-y-1.5 px-3 py-2">
                <SegmentedBar parts={parts} label={`Cómo terminó ${row.courseName}`} />
                <p className="text-xs text-slate-600">
                  {parts
                    .filter((part) => part.value > 0)
                    .map((part) => `${part.label}: ${formatShare(part.value, row.enrolled)}`)
                    .join(' · ')}
                </p>
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{formatCount(row.notReenrolled)}</td>
            </tr>
          )
        })}
      </Table>
      <PartsList parts={outcomeParts(data.total)} unit="matriculados" />
    </Panel>
  )
}

function ByYear({ data }: Readonly<{ data: TrajectoryResponse }>) {
  return (
    <Panel title="Año a año" description="Cada ciclo con datos. El ciclo en curso todavía no tiene fallo.">
      <Table head={['Ciclo', 'Matriculados', 'Promovieron', 'Repitieron', 'Egresaron', 'Se fueron en el año', 'No se reinscribieron', 'Cursando']} minWidth={820}>
        {data.byYear.map((year) => (
          <tr key={year.id}>
            <th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-900">
              {year.label}
            </th>
            <td className="px-3 py-1.5 tabular-nums">{formatCount(year.enrolled)}</td>
            <td className="px-3 py-1.5 tabular-nums">{formatCount(year.promoted + year.promotedWithPending)}</td>
            <td className="px-3 py-1.5 tabular-nums">{formatCount(year.repeated)}</td>
            <td className="px-3 py-1.5 tabular-nums">{formatCount(year.graduated + year.graduatedWithPending)}</td>
            <td className="px-3 py-1.5 tabular-nums">{formatCount(year.leftWithdrawn + year.leftTransferred)}</td>
            <td className="px-3 py-1.5 tabular-nums">{formatCount(year.notReenrolled)}</td>
            <td className="px-3 py-1.5 tabular-nums">{formatCount(year.inProgress)}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

function CohortRow({ cohort }: Readonly<{ cohort: Cohort }>) {
  const parts = cohortParts(cohort)
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{cohortLabel(cohort)}</h4>
        <p className="text-xs text-slate-500">{formatCount(cohort.entrants)} entraron al primer grado</p>
      </div>
      <SegmentedBar parts={parts} label={cohortLabel(cohort)} />
      <PartsList parts={parts} unit="estudiantes" />
    </li>
  )
}

function Cohorts({ data }: Readonly<{ data: TrajectoryResponse }>) {
  return (
    <Panel
      title="Qué pasó con cada generación"
      description="Quienes entraron al primer grado del nivel cada año, seguidos hasta hoy. En tiempo: sin repetir. Los que entraron por pase a otro grado no forman generación."
    >
      {data.cohorts.length === 0 ? (
        <EmptyNote>Todavía no hay generaciones para seguir.</EmptyNote>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {data.cohorts.map((cohort) => (
            <CohortRow key={`${cohort.level}-${cohort.entryYear}`} cohort={cohort} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Promoción, repetición, egreso y desvinculación del último año cerrado, año a año y por generación. */
export default function TrajectorySection({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const trajectory = useIndicatorData<TrajectoryResponse>(ctx.paths.trajectory)
  if (!trajectory.data) return <LoadState state={trajectory} what="la trayectoria" />
  const data = trajectory.data
  const note = focusNote(data.requestedYear, data.focusYear, 'todavía no terminó')
  return (
    <div className="space-y-5">
      {data.focusYear ? (
        <>
          <p className="text-sm text-slate-700">
            Cómo terminó {data.focusYear.label}.{note ? ` ${note}` : ''}
          </p>
          <Headline data={data} />
          <ByCourse data={data} />
        </>
      ) : (
        <EmptyNote>Todavía no terminó ningún ciclo: la trayectoria aparece cuando cierra el primero.</EmptyNote>
      )}
      {data.byYear.length > 0 && <ByYear data={data} />}
      <Cohorts data={data} />
    </div>
  )
}
