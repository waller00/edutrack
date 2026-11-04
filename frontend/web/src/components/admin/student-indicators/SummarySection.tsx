'use client'

import Link from 'next/link'
import StatTile from '@/components/common/StatTile'
import { attendanceTrendPoints, presentDays, type AttendanceTrendResponse, type LowSubjectsHistogram, type RiskResponse } from '@/lib/admin/student-indicators'
import { trajectoryHeadline, type TrajectoryResponse } from '@/lib/admin/student-trajectory'
import { formatCount, formatRatio, formatShare } from '@/lib/format/percent'
import { useIndicatorData, type IndicatorData } from './indicator-data'
import { EmptyNote, LoadState, Panel, type IndicatorContext } from './parts'
import { RiskTable } from './RiskSection'

const loadingTile = (label: string) => <StatTile label={label} value="…" detail="Calculando…" />

function errorTile(label: string, retry: () => void) {
  return (
    <StatTile label={label} value="—" detail="No se pudo calcular.">
      <button type="button" onClick={retry} className="mt-2 self-start text-xs font-semibold text-emerald-700 underline">
        Reintentar
      </button>
    </StatTile>
  )
}

function RiskTile({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const risk = useIndicatorData<RiskResponse>(ctx.paths.risk)
  const label = 'Necesitan atención'
  if (risk.error) return errorTile(label, risk.retry)
  if (!risk.data) return loadingTile(label)
  const { counts, enrolled } = risk.data
  return (
    <StatTile
      label={label}
      value={formatCount(counts.students)}
      detail={`${formatShare(counts.students, enrolled)} estudiantes del ciclo. ${counts.grades} por notas, ${counts.absences} por faltas y ${counts.both} por las dos.`}
    />
  )
}

function AttendanceTile({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const trend = useIndicatorData<AttendanceTrendResponse>(ctx.paths.trend)
  const label = 'Asistencia del año'
  if (trend.error) return errorTile(label, trend.retry)
  if (!trend.data) return loadingTile(label)
  const { total } = trend.data
  if (total.studentDays === 0) return <StatTile label={label} value="—" detail="Todavía no hay listas pasadas en el ciclo." />
  return (
    <StatTile
      label={label}
      value={formatRatio(presentDays(total), total.studentDays)}
      detail={`${formatCount(presentDays(total))} de ${formatCount(total.studentDays)} días con lista, sin falta. Llegar tarde cuenta como que vino.`}
      trend={attendanceTrendPoints(trend.data).map((point) => point.liceo)}
    />
  )
}

type Dashboard = { referencePeriod: { name: string } | null; lowSubjects: LowSubjectsHistogram }

function LowSubjectsTile({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const dashboard = useIndicatorData<Dashboard>(ctx.paths.dashboard)
  const label = 'Con materias bajas en el boletín'
  if (dashboard.error) return errorTile(label, dashboard.retry)
  if (!dashboard.data) return loadingTile(label)
  const { lowSubjects, referencePeriod } = dashboard.data
  if (!referencePeriod || lowSubjects.graded === 0) return <StatTile label={label} value="—" detail="Todavía no hay notas de boletín." />
  const withLow = lowSubjects.graded - lowSubjects.none
  return (
    <StatTile
      label={label}
      value={formatRatio(withLow, lowSubjects.graded)}
      detail={`${formatShare(withLow, lowSubjects.graded)} estudiantes con notas tienen al menos una materia baja en ${referencePeriod.name}.`}
    />
  )
}

function PromotionTile({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const trajectory = useIndicatorData<TrajectoryResponse>(ctx.paths.trajectory)
  const label = 'Promoción del último año cerrado'
  if (trajectory.error) return errorTile(label, trajectory.retry)
  if (!trajectory.data) return loadingTile(label)
  const { focusYear, total, byCourse } = trajectory.data
  if (!focusYear) return <StatTile label={label} value="—" detail="Todavía no terminó ningún ciclo." />
  const headline = trajectoryHeadline(total, byCourse)
  const passed = headline.promoted + headline.graduated
  return (
    <StatTile
      label={label}
      value={formatRatio(passed, headline.enrolled)}
      detail={`${formatShare(passed, headline.enrolled)} matriculados en ${focusYear.label} promovieron o egresaron. ${headline.repeated} repitieron y ${headline.left} dejaron el liceo.`}
    />
  )
}

function FirstToLook({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const risk = useIndicatorData<RiskResponse>(ctx.paths.risk)
  return (
    <Panel
      tour="student-indicators.risk"
      title="Para mirar primero"
      description="Quienes tienen a la vez notas y faltas para mirar, y después los casos más avanzados."
      actions={
        risk.data && risk.data.rows.length > 5 ? (
          <Link href={ctx.sectionHref({ seccion: 'riesgo' })} className="text-sm font-medium text-emerald-700 hover:underline">
            Ver a los {risk.data.rows.length} →
          </Link>
        ) : null
      }
    >
      <FirstToLookBody risk={risk} query={ctx.query} />
    </Panel>
  )
}

function FirstToLookBody({ risk, query }: Readonly<{ risk: IndicatorData<RiskResponse>; query: string }>) {
  if (!risk.data) return <LoadState state={risk} what="quién necesita atención" />
  if (risk.data.rows.length === 0) return <EmptyNote>Nadie necesita atención por ahora.</EmptyNote>
  return <RiskTable rows={risk.data.rows} query={query} limit={5} />
}

/** Cuatro números del ciclo y a quién mirar primero. Cada mosaico, sólo si se puede ver su fuente. */
export default function SummarySection({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const { analytics, reports } = ctx.access
  return (
    <div className="space-y-5">
      <div data-tour="student-indicators.summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {reports && <RiskTile ctx={ctx} />}
        {reports && <AttendanceTile ctx={ctx} />}
        {analytics && <LowSubjectsTile ctx={ctx} />}
        {analytics && <PromotionTile ctx={ctx} />}
      </div>
      {reports && <FirstToLook ctx={ctx} />}
    </div>
  )
}
