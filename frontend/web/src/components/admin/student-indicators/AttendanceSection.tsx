'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import StatTile from '@/components/common/StatTile'
import {
  ACCENT_COLOR,
  attendanceTrendPoints,
  CONTEXT_COLOR,
  matchesStudent,
  monthLabel,
  ORDINAL_COLORS,
  presentDays,
  type AbsenceStreak,
  type AbsenceThreshold,
  type AttendanceStudent,
  type AttendanceTrendResponse,
  type RiskResponse,
  type TrendPoint,
} from '@/lib/admin/student-indicators'
import { formatCount, formatPercent, formatRatio, formatShare } from '@/lib/format/percent'
import { absencesText, shortDate } from '@/components/admin/student-reports/shared'
import { useIndicatorData } from './indicator-data'
import { ChartFrame, EmptyNote, LoadState, Panel, StudentName, Table, type IndicatorContext } from './parts'

const UNJUSTIFIED_COLOR = ORDINAL_COLORS[2]
const JUSTIFIED_COLOR = ORDINAL_COLORS[0]
const AXIS_TICK = { fontSize: 11, fill: '#64748b' }

function AttendanceTiles({ trend, ctx }: Readonly<{ trend: AttendanceTrendResponse; ctx: IndicatorContext }>) {
  const streaks = useIndicatorData<{ data: AbsenceStreak[] }>(ctx.paths.streaks)
  const thresholds = useIndicatorData<{ data: AbsenceThreshold[] }>(ctx.paths.thresholds)
  const risk = useIndicatorData<RiskResponse>(ctx.paths.risk)
  const { total } = trend
  const over18 = thresholds.data?.data.length
  const over25 = thresholds.data?.data.filter((row) => row.absenceHundredths >= 2500).length ?? 0
  const openStreaks = streaks.data ? new Set(streaks.data.data.filter((row) => row.open).map((row) => row.studentId)).size : undefined
  const enrolled = risk.data?.enrolled
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <StatTile
        label="Asistencia del año"
        value={formatRatio(presentDays(total), total.studentDays)}
        detail={`${formatCount(presentDays(total))} de ${formatCount(total.studentDays)} días con lista, sin falta.`}
      />
      <StatTile
        label="Faltas justificadas"
        value={formatRatio(total.justifiedDays, total.absentDays)}
        detail={`${formatCount(total.justifiedDays)} de ${formatCount(total.absentDays)} días con falta tenían justificativo.`}
      />
      <StatTile
        label="Llegadas tarde"
        value={formatCount(total.lateDays)}
        detail={`En ${formatRatio(total.lateDays, total.studentDays)} de los días con lista. Cuentan como que vino.`}
      />
      <StatTile
        label="18 faltas o más"
        value={over18 === undefined ? '…' : formatCount(over18)}
        detail={over18 !== undefined && enrolled !== undefined ? `${formatShare(over18, enrolled)} estudiantes del ciclo.` : 'Contadas como en el boletín.'}
        tone={over25 > 0 ? 'critical' : 'neutral'}
        toneText={`${over25} con 25 o más`}
      />
      <StatTile
        label="Faltas seguidas que siguen"
        value={openStreaks === undefined ? '…' : formatCount(openStreaks)}
        detail="Estudiantes con 3 o más días de clase seguidos con falta, que todavía no volvieron."
      />
    </div>
  )
}

function Legend({ items }: Readonly<{ items: readonly { label: string; color: string; kind: 'line' | 'bar' }[] }>) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className={item.kind === 'line' ? 'h-0.5 w-4 rounded-full' : 'h-2.5 w-2.5 rounded-sm'}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

const percentOrDash = (value: number | null) => (value === null ? '—' : formatPercent(value))

function MonthlyAttendance({ trend }: Readonly<{ trend: AttendanceTrendResponse }>) {
  const [courseId, setCourseId] = useState('')
  const points = attendanceTrendPoints(trend, courseId || null)
  const course = trend.byCourse.find((row) => row.courseOfferingId === courseId)
  const known = points.flatMap((p) => [p.liceo, p.course]).filter((v): v is number => v !== null)
  const floor = Math.max(0, Math.floor((Math.min(...known, 100) - 2) / 5) * 5)
  const description = points.map((p) => `${p.label}: ${percentOrDash(p.liceo)}${course ? `, ${course.courseName} ${percentOrDash(p.course)}` : ''}`).join('. ')
  return (
    <Panel
      title="Asistencia por mes"
      description="Días con lista sin falta, sobre los días con lista de cada mes."
      actions={
        <label className="text-xs text-slate-600">
          <span className="mr-2">Destacar un curso</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="select-field">
            <option value="">Ninguno</option>
            {trend.byCourse.map((row) => (
              <option key={row.courseOfferingId} value={row.courseOfferingId}>
                {row.courseName}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {course && (
        <Legend
          items={[
            { label: course.courseName, color: ACCENT_COLOR, kind: 'line' },
            { label: 'Todo el liceo', color: CONTEXT_COLOR, kind: 'line' },
          ]}
        />
      )}
      <ChartFrame label="Gráfica de asistencia por mes" description={description} height={240} table={<MonthTable points={points} courseName={course?.courseName} />}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: -8 }} accessibilityLayer>
            <CartesianGrid stroke="#eef2f6" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
            <YAxis domain={[floor, 100]} tickFormatter={(v: number) => `${v} %`} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
            <Tooltip formatter={(value, name) => [percentOrDash(typeof value === 'number' ? value : null), name]} />
            <Line
              isAnimationActive={false}
              dataKey="liceo"
              name="Todo el liceo"
              stroke={course ? CONTEXT_COLOR : ACCENT_COLOR}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: course ? CONTEXT_COLOR : ACCENT_COLOR }}
            />
            {course && (
              <Line
                isAnimationActive={false}
                dataKey="course"
                name={course.courseName}
                stroke={ACCENT_COLOR}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: ACCENT_COLOR }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    </Panel>
  )
}

function MonthTable({ points, courseName }: Readonly<{ points: readonly TrendPoint[]; courseName?: string }>) {
  return (
    <Table head={['Mes', 'Todo el liceo', ...(courseName ? [courseName] : []), 'Días sin justificar', 'Días justificados', 'Días con lista']} minWidth={520}>
      {points.map((p) => (
        <tr key={p.month}>
          <td className="px-3 py-1.5">{p.label}</td>
          <td className="px-3 py-1.5 tabular-nums">{percentOrDash(p.liceo)}</td>
          {courseName && <td className="px-3 py-1.5 tabular-nums">{percentOrDash(p.course)}</td>}
          <td className="px-3 py-1.5 tabular-nums">{formatCount(p.unjustified)}</td>
          <td className="px-3 py-1.5 tabular-nums">{formatCount(p.justified)}</td>
          <td className="px-3 py-1.5 tabular-nums">{formatCount(p.studentDays)}</td>
        </tr>
      ))}
    </Table>
  )
}

function MonthlyAbsences({ trend }: Readonly<{ trend: AttendanceTrendResponse }>) {
  const points = attendanceTrendPoints(trend)
  const description = points.map((p) => `${p.label}: ${p.unjustified} días sin justificar y ${p.justified} justificados`).join('. ')
  return (
    <Panel title="Días con falta por mes" description="Cada día con falta de cada estudiante, sin justificar y justificados.">
      <Legend
        items={[
          { label: 'Sin justificar', color: UNJUSTIFIED_COLOR, kind: 'bar' },
          { label: 'Justificadas', color: JUSTIFIED_COLOR, kind: 'bar' },
        ]}
      />
      <ChartFrame label="Gráfica de días con falta por mes" description={description} height={240} table={<MonthTable points={points} />}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: -8 }} accessibilityLayer>
            <CartesianGrid stroke="#eef2f6" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
            <Tooltip cursor={{ fill: '#f8fafc' }} />
            <Bar isAnimationActive={false} dataKey="unjustified" name="Sin justificar" stackId="faltas" fill={UNJUSTIFIED_COLOR} stroke="#fff" strokeWidth={2} maxBarSize={24} />
            <Bar
              isAnimationActive={false}
              dataKey="justified"
              name="Justificadas"
              stackId="faltas"
              fill={JUSTIFIED_COLOR}
              stroke="#fff"
              strokeWidth={2}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </Panel>
  )
}

function CourseMonthTable({ trend }: Readonly<{ trend: AttendanceTrendResponse }>) {
  return (
    <Panel title="Asistencia por curso y mes" description="Cada celda: días con lista sin falta, sobre los días con lista del curso ese mes.">
      <Table head={['Curso', ...trend.months.map(monthLabel), 'Año']} minWidth={Math.max(480, 120 + trend.months.length * 64)}>
        {trend.byCourse.map((course) => (
          <tr key={course.courseOfferingId}>
            <th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-900">
              {course.courseName}
            </th>
            {course.months.map((month) => (
              <td key={month.month} className="px-3 py-1.5 tabular-nums">
                {formatRatio(presentDays(month), month.studentDays)}
              </td>
            ))}
            <td className="px-3 py-1.5 font-medium tabular-nums">{formatRatio(presentDays(course.total), course.total.studentDays)}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

type ListId = 'seguidas' | 'faltas'
const LISTS: { id: ListId; label: string }[] = [
  { id: 'seguidas', label: 'Faltas seguidas' },
  { id: 'faltas', label: '18 y 25 faltas' },
]

function StreaksTable({ rows, query }: Readonly<{ rows: readonly AbsenceStreak[]; query: string }>) {
  return (
    <Table head={['Estudiante', 'Curso', 'Desde', 'Hasta', 'Días', 'Estado']}>
      {rows.map((row) => (
        <tr key={`${row.studentId}-${row.from}`}>
          <td className="px-3 py-2.5">
            <StudentName student={row} query={query} />
          </td>
          <td className="px-3 py-2.5">{row.courseName}</td>
          <td className="px-3 py-2.5 tabular-nums">{shortDate(row.from)}</td>
          <td className="px-3 py-2.5 tabular-nums">{shortDate(row.to)}</td>
          <td className="px-3 py-2.5 tabular-nums">{row.days}</td>
          <td className="px-3 py-2.5">{row.open ? <span className="font-medium text-rose-700">Sigue faltando</span> : <span className="text-slate-500">Cortada</span>}</td>
        </tr>
      ))}
    </Table>
  )
}

function ThresholdsTable({ rows, query }: Readonly<{ rows: readonly AbsenceThreshold[]; query: string }>) {
  return (
    <Table head={['Estudiante', 'Curso', 'Faltas del año', 'Umbral']} minWidth={480}>
      {rows.map((row) => (
        <tr key={row.studentId}>
          <td className="px-3 py-2.5">
            <StudentName student={row} query={query} />
          </td>
          <td className="px-3 py-2.5">{row.courseName}</td>
          <td className="px-3 py-2.5 tabular-nums">{absencesText(row.absenceHundredths)}</td>
          <td className="px-3 py-2.5">
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${row.absenceHundredths >= 2500 ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
              {row.absenceHundredths >= 2500 ? 'Pasó las 25' : 'Pasó las 18'}
            </span>
          </td>
        </tr>
      ))}
    </Table>
  )
}

function ListRows({
  total,
  limit,
  unit,
  onMore,
  children,
}: Readonly<{ total: number; limit: number; unit: string; onMore: () => void; children: React.ReactNode }>) {
  if (total === 0) return <EmptyNote>No hay estudiantes para mostrar con estos filtros.</EmptyNote>
  return (
    <>
      <p aria-live="polite" className="text-xs text-slate-500">
        Mostrando {Math.min(limit, total)} de {total} {unit}
      </p>
      {children}
      {limit < total && (
        <button type="button" onClick={onMore} className="min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600">
          Mostrar 20 más
        </button>
      )}
    </>
  )
}

function useFiltered<T extends AttendanceStudent>(rows: readonly T[] | undefined, filters: { search: string; course: string }) {
  return (rows ?? []).filter((row) => (!filters.course || row.courseName === filters.course) && matchesStudent(row, filters.search))
}

/** Las listas de siempre: rachas de faltas y quién llegó a 18 y 25. `?lista=` abre la de cada aviso. */
type ListFilters = { search: string; course: string }

function ListFiltersRow({
  filters,
  courses,
  onChange,
}: Readonly<{ filters: ListFilters; courses: readonly string[]; onChange: (next: ListFilters) => void }>) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 sm:min-w-48">
        <span className="mb-1.5 block text-xs font-medium text-slate-500">Buscar estudiante o curso</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm"
            placeholder="Nombre, apellido o curso"
          />
        </span>
      </label>
      <label className="w-full sm:w-48">
        <span className="mb-1.5 block text-xs font-medium text-slate-500">Curso</span>
        <select value={filters.course} onChange={(e) => onChange({ ...filters, course: e.target.value })} className="select-field w-full">
          <option value="">Todos los cursos</option>
          {courses.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

const KEY_LIST: Record<string, ListId> = { Home: 'seguidas', End: 'faltas' }

/** Pestañas con flechas, Inicio y Fin; el panel lleva el id que las nombra. */
function ListTabs({ tabsId, list, onChoose }: Readonly<{ tabsId: string; list: ListId; onChoose: (id: ListId) => void }>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = KEY_LIST[event.key] ?? (list === 'seguidas' ? 'faltas' : 'seguidas')
    onChoose(next)
    document.getElementById(`${tabsId}-${next}`)?.focus()
  }
  return (
    <div role="tablist" aria-label="Listas de asistencia" onKeyDown={onKeyDown} className="flex flex-wrap gap-1 border-b border-slate-200">
      {LISTS.map((tab) => {
        const selected = list === tab.id
        return (
          <button
            key={tab.id}
            id={`${tabsId}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${tabsId}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(tab.id)}
            className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-medium ${selected ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

const coursesOf = (...lists: (readonly AttendanceStudent[] | undefined)[]) =>
  [...new Set(lists.flatMap((rows) => rows ?? []).map((row) => row.courseName))].sort((a, b) => a.localeCompare(b, 'es'))

/** Las listas de siempre: rachas de faltas y quién llegó a 18 y 25. `?lista=` abre la de cada aviso. */
function AttendanceLists({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const params = useSearchParams()
  const router = useRouter()
  const tabsId = useId()
  const list: ListId = params?.get('lista') === 'faltas' ? 'faltas' : 'seguidas'
  const streaks = useIndicatorData<{ data: AbsenceStreak[] }>(ctx.paths.streaks)
  const thresholds = useIndicatorData<{ data: AbsenceThreshold[] }>(ctx.paths.thresholds)
  const [filters, setFilters] = useState<ListFilters>({ search: '', course: '' })
  const [limit, setLimit] = useState(20)
  const streakRows = useFiltered(streaks.data?.data, filters)
  const thresholdRows = useFiltered(thresholds.data?.data, filters)
  const isStreaks = list === 'seguidas'
  const active = isStreaks ? streaks : thresholds
  const choose = (id: ListId) => {
    setLimit(20)
    router.replace(ctx.sectionHref({ seccion: 'asistencia', lista: id }), { scroll: false })
  }
  const table = isStreaks ? (
    <StreaksTable rows={streakRows.slice(0, limit)} query={ctx.query} />
  ) : (
    <ThresholdsTable rows={thresholdRows.slice(0, limit)} query={ctx.query} />
  )

  return (
    <Panel
      title="A quién llamar"
      description="Faltas seguidas: 3 o más días de clase con falta entera sin justificar (fines de semana y feriados no cortan la racha). 18 y 25 faltas: el total del año, contado como en el boletín."
    >
      <ListFiltersRow
        filters={filters}
        courses={coursesOf(streaks.data?.data, thresholds.data?.data)}
        onChange={(next) => {
          setFilters(next)
          setLimit(20)
        }}
      />
      <ListTabs tabsId={tabsId} list={list} onChoose={choose} />
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${list}`} className="space-y-3">
        {active.data ? (
          <ListRows
            total={isStreaks ? streakRows.length : thresholdRows.length}
            limit={limit}
            unit={isStreaks ? 'rachas' : 'estudiantes'}
            onMore={() => setLimit((n) => n + 20)}
          >
            {table}
          </ListRows>
        ) : (
          <LoadState state={active} what="la lista" />
        )}
      </div>
    </Panel>
  )
}

/**
 * Asistencia de los estudiantes, contada por día como el boletín: faltar a una clase es faltar el
 * día, y llegar tarde es que vino. Sólo cuentan las listas pasadas.
 */
export default function AttendanceSection({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const trend = useIndicatorData<AttendanceTrendResponse>(ctx.paths.trend)
  return (
    <div className="space-y-5">
      {trend.data ? <TrendBlocks trend={trend.data} ctx={ctx} /> : <LoadState state={trend} what="la asistencia" />}
      <AttendanceLists ctx={ctx} />
    </div>
  )
}

function TrendBlocks({ trend, ctx }: Readonly<{ trend: AttendanceTrendResponse; ctx: IndicatorContext }>) {
  if (trend.total.studentDays === 0) return <EmptyNote>Todavía no hay listas pasadas en el ciclo.</EmptyNote>
  return (
    <>
      <AttendanceTiles trend={trend} ctx={ctx} />
      <div className="grid gap-5 xl:grid-cols-2">
        <MonthlyAttendance trend={trend} />
        <MonthlyAbsences trend={trend} />
      </div>
      <CourseMonthTable trend={trend} />
    </>
  )
}
