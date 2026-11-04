'use client'

import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import StatTile from '@/components/common/StatTile'
import { PartsList, SegmentedBar } from '@/components/charts/SegmentedBar'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import {
  ACCENT_COLOR,
  alertSubjectsRule,
  evolutionParts,
  lowSubjectsParts,
  type LowSubjectsHistogram,
  type StudentsEvolution,
} from '@/lib/admin/student-indicators'
import type { ComparisonDimension } from '@/lib/admin/student-indicators-sections'
import { formatCount, formatRatio, formatShare, ratioValue } from '@/lib/format/percent'
import { gradeText } from '@/components/admin/student-reports/shared'
import { useIndicatorData } from './indicator-data'
import { ChartFrame, EmptyNote, LoadState, Panel, studentName, Table, type IndicatorContext } from './parts'

type Bucket = { levelId: string; label: string; isAlert: boolean; count: number }

type Dashboard = {
  scale: { name: string } | null
  referencePeriod: { id: string; name: string } | null
  students: StudentsEvolution & { atRisk: number }
  performance: { averageHundredths: number | null; medianHundredths: number | null; distribution: Bucket[]; gradedCount: number }
  lowSubjects: LowSubjectsHistogram
  rules?: { type: string; threshold: number }[]
  disclaimer: string
}

type ComparisonRow = {
  key: string
  label: string
  averageHundredths: number | null
  medianHundredths: number | null
  gradedCount: number
  studentCount: number
  alertCount: number
}

type GradeDrop = { studentId: string; firstName: string; lastName: string; courseName: string; subjectId: string; subjectName: string; previous: number; current: number }
type GradeDrops = { period: { name: string }; previous: { name: string } | null; rows: GradeDrop[] }

const AXIS_TICK = { fontSize: 11, fill: '#64748b' }

/** Los tramos en alerta, dichos en palabras: «Insuficiente o En proceso». */
const alertNames = (buckets: readonly Bucket[]) =>
  buckets
    .filter((b) => b.isAlert)
    .map((b) => b.label)
    .join(' o ')

function PerformanceTiles({ data }: Readonly<{ data: Dashboard }>) {
  const { performance, referencePeriod } = data
  const low = performance.distribution.filter((b) => b.isAlert).reduce((acc, b) => acc + b.count, 0)
  const period = referencePeriod?.name ?? 'el boletín'
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatTile label="Promedio" value={formatHundredths(performance.averageHundredths, 1)} detail={`De ${formatCount(performance.gradedCount)} notas (R) de ${period}.`} />
      <StatTile label="Mediana" value={formatHundredths(performance.medianHundredths, 1)} detail="La mitad de las notas está por debajo y la mitad por encima." />
      <StatTile
        label="Notas bajas"
        value={formatRatio(low, performance.gradedCount)}
        detail={`${formatCount(low)} de ${formatCount(performance.gradedCount)} notas en ${alertNames(performance.distribution) || 'tramo de alerta'}.`}
      />
    </div>
  )
}

function Distribution({ data }: Readonly<{ data: Dashboard }>) {
  const { distribution, gradedCount } = data.performance
  const rows = distribution.map((b) => ({ ...b, axis: b.isAlert ? `${b.label} ▲` : b.label }))
  const description = distribution.map((b) => `${b.label}${b.isAlert ? ' (alerta)' : ''}: ${formatShare(b.count, gradedCount)} notas`).join('. ')
  return (
    <Panel title="Distribución de las notas" description={`Cada nota (R) del boletín según el tramo de la escala${data.scale ? ` (${data.scale.name})` : ''}. ▲ marca los tramos en alerta.`}>
      <ChartFrame
        label="Gráfica de la distribución de las notas"
        description={description}
        height={240}
        table={
          <Table head={['Tramo', 'Notas']} minWidth={320}>
            {distribution.map((b) => (
              <tr key={b.levelId}>
                <td className="px-3 py-1.5">
                  {b.label}
                  {b.isAlert && <span className="ml-1 text-xs text-amber-800">▲ alerta</span>}
                </td>
                <td className="px-3 py-1.5 tabular-nums">{formatShare(b.count, gradedCount)}</td>
              </tr>
            ))}
          </Table>
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -8 }} accessibilityLayer>
            <CartesianGrid stroke="#eef2f6" vertical={false} />
            <XAxis dataKey="axis" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} interval={0} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(value) => [formatShare(Number(value), gradedCount), 'Notas']} />
            <Bar isAnimationActive={false} dataKey="count" name="Notas" fill={ACCENT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </Panel>
  )
}

function LowSubjects({ data }: Readonly<{ data: Dashboard }>) {
  const threshold = alertSubjectsRule(data.rules)
  const parts = lowSubjectsParts(data.lowSubjects, threshold)
  return (
    <Panel
      title="Estudiantes según sus materias bajas"
      description={
        threshold === null
          ? 'Cuántas materias tiene bajas cada estudiante en el boletín. La regla de asignaturas en alerta está apagada.'
          : `Cuántas materias tiene bajas cada estudiante en el boletín. Desde ${threshold} la reunión lo marca en riesgo.`
      }
    >
      {data.lowSubjects.graded === 0 ? (
        <EmptyNote>Todavía no hay notas de boletín.</EmptyNote>
      ) : (
        <>
          <SegmentedBar parts={parts} label="Estudiantes según sus materias bajas" />
          <PartsList parts={parts} unit="estudiantes" />
        </>
      )}
    </Panel>
  )
}

function DropsList({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const drops = useIndicatorData<GradeDrops>(ctx.paths.drops)
  if (!ctx.paths.drops) return <EmptyNote>Elegí un boletín.</EmptyNote>
  if (!drops.data) return <LoadState state={drops} what="quiénes bajaron" />
  if (!drops.data.previous) return <EmptyNote>Es el primer boletín: no hay uno anterior con qué comparar.</EmptyNote>
  if (drops.data.rows.length === 0) return <EmptyNote>Nadie bajó respecto de {drops.data.previous.name}.</EmptyNote>
  const { previous, period, rows } = drops.data
  return (
    <Table head={['Estudiante', 'Curso', 'Materia', previous.name, period.name]}>
      {rows.map((row) => (
        <tr key={`${row.studentId}-${row.subjectId}`}>
          <td className="px-3 py-1.5 font-medium">{studentName(row)}</td>
          <td className="px-3 py-1.5">{row.courseName}</td>
          <td className="px-3 py-1.5">{row.subjectName}</td>
          <td className="px-3 py-1.5 tabular-nums">{gradeText(row.previous)}</td>
          <td className="px-3 py-1.5 tabular-nums text-amber-800">
            {gradeText(row.current)} <span className="text-xs">(bajó)</span>
          </td>
        </tr>
      ))}
    </Table>
  )
}

function Evolution({ data, ctx }: Readonly<{ data: Dashboard; ctx: IndicatorContext }>) {
  const parts = evolutionParts(data.students)
  return (
    <Panel title="Evolución desde el primer boletín" description="El promedio de cada estudiante en cada boletín hasta el elegido. Sin comparación: tiene un solo boletín con notas.">
      <SegmentedBar parts={parts} label="Evolución de los estudiantes" />
      <PartsList parts={parts} unit="estudiantes" />
      <details className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Quiénes bajaron en alguna materia respecto del boletín anterior</summary>
        <div className="mt-3">
          <DropsList ctx={ctx} />
        </div>
      </details>
    </Panel>
  )
}

const DIMENSIONS: { id: ComparisonDimension; label: string }[] = [
  { id: 'SUBJECT', label: 'Por asignatura' },
  { id: 'COURSE', label: 'Por curso' },
  { id: 'YEAR', label: 'Por año lectivo' },
]

function ComparisonRows({ rows }: Readonly<{ rows: readonly ComparisonRow[] }>) {
  if (rows.length === 0) return <EmptyNote>No hay notas de boletín para comparar.</EmptyNote>
  const sorted = [...rows].sort((a, b) => (ratioValue(b.alertCount, b.gradedCount) ?? -1) - (ratioValue(a.alertCount, a.gradedCount) ?? -1))
  return (
    <Table head={['Grupo', 'Notas bajas', 'Promedio', 'Mediana', 'Estudiantes']} minWidth={640}>
      {sorted.map((row) => (
        <tr key={row.key}>
          <th scope="row" className="px-3 py-2 text-left font-medium text-slate-900">
            {row.label}
          </th>
          <td className="px-3 py-2">
            <span className="flex items-center gap-2">
              <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${ratioValue(row.alertCount, row.gradedCount) ?? 0}%`, background: ACCENT_COLOR }} />
              </span>
              <span className="tabular-nums">{formatShare(row.alertCount, row.gradedCount)} notas</span>
            </span>
          </td>
          <td className="px-3 py-2 tabular-nums">{formatHundredths(row.averageHundredths, 1)}</td>
          <td className="px-3 py-2 tabular-nums">{formatHundredths(row.medianHundredths, 1)}</td>
          <td className="px-3 py-2 tabular-nums">{formatCount(row.studentCount)}</td>
        </tr>
      ))}
    </Table>
  )
}

function Comparison({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const [dimension, setDimension] = useState<ComparisonDimension>('SUBJECT')
  const comparison = useIndicatorData<{ data: ComparisonRow[] }>(ctx.paths.comparison(dimension, ctx.schoolYearIds))
  return (
    <Panel
      title="Comparar"
      description="Notas bajas de cada grupo sobre sus notas del boletín, de más a menos. Por año, el mismo boletín en cada ciclo."
      actions={
        <select value={dimension} onChange={(e) => setDimension(e.target.value as ComparisonDimension)} aria-label="Comparar por" className="select-field">
          {DIMENSIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      }
    >
      {comparison.data ? <ComparisonRows rows={comparison.data.data} /> : <LoadState state={comparison} what="la comparación" />}
    </Panel>
  )
}

/** Las notas (R) del boletín elegido: cómo se reparten, quiénes tienen materias bajas y cómo evolucionan. */
export default function PerformanceSection({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const dashboard = useIndicatorData<Dashboard>(ctx.paths.dashboard)
  if (!dashboard.data) return <LoadState state={dashboard} what="el rendimiento" />
  const data = dashboard.data
  if (!data.referencePeriod || data.performance.gradedCount === 0) return <EmptyNote>Todavía no hay notas de boletín en este ciclo.</EmptyNote>
  return (
    <div className="space-y-5">
      <PerformanceTiles data={data} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Distribution data={data} />
        <LowSubjects data={data} />
      </div>
      <Evolution data={data} ctx={ctx} />
      <Comparison ctx={ctx} />
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer font-medium">Sobre estos indicadores</summary>
        <p className="mt-2 max-w-3xl leading-relaxed">{data.disclaimer}</p>
      </details>
    </div>
  )
}
