'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import GradeFollowUp from '@/components/admin/student-reports/GradeFollowUp'
import AttendanceOverview from '@/components/admin/student-attendance/AttendanceOverview'
import StudentOverview from './StudentOverview'
import { Loader2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { formatHundredths } from '@/lib/academic-config/grade-value'

type Bucket = {
  levelId: string
  label: string
  colorToken: string | null
  isAlert: boolean
  count: number
  percentage: number
}

type Level = 'EBI' | 'EMS'
type Period = { id: string; name: string; level?: Level | null }

export const LEVEL_LABELS: Record<Level, string> = {
  EBI: 'Ciclo básico',
  EMS: 'Bachillerato',
}

/** Niveles que tienen reuniones en el ciclo; sin datos, los dos. */
export function availableLevels(periods: readonly Period[]): Level[] {
  const found = (['EBI', 'EMS'] as const).filter((level) => periods.some((p) => p.level === level))
  return found.length > 0 ? [...found] : ['EBI', 'EMS']
}

export function dashboardQuery(level: Level, periodId: string): string {
  const params = new URLSearchParams({ level })
  if (periodId) params.set('periodId', periodId)
  return params.toString()
}

type Dashboard = {
  level?: Level | null
  scale?: { name: string } | null
  referencePeriod?: { id: string; name: string } | null
  students: {
    total: number
    evaluated: number
    withoutAssessments: number
    atRisk: number
    improved: number
    declined: number
  }
  performance: {
    averageHundredths: number | null
    medianHundredths: number | null
    distribution: Bucket[]
    gradedCount: number
  }
  management: {
    gradeBooks: number
    complete: number
    incomplete: number
    pendingClosures: number
    pendingEndorsements: number
    endorsedPercentage: number
    lateClosures: number
    startedPercentage: number
  }
  disclaimer: string
}

type ComparisonRow = {
  key: string
  label: string
  averageHundredths: number | null
  medianHundredths: number | null
  gradedCount: number
  studentCount: number
  alertPercentage: number
}

/** Paleta fija por token: Tailwind purga las clases construidas por concatenación. */
const BAR_COLORS: Record<string, string> = {
  red: '#ef4444',
  amber: '#f59e0b',
  green: '#22c55e',
  emerald: '#10b981',
  blue: '#3b82f6',
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

export type DashboardView = 'summary' | 'performance' | 'management' | 'followup' | 'attendance'

/** Las vistas del tablero; "Seguimiento" sólo para quien ve los reportes de estudiantes. */
function ViewSwitcher({
  view,
  onChange,
  followUp,
}: {
  view: DashboardView
  onChange: (view: DashboardView) => void
  followUp: boolean
}) {
  const options: (readonly [DashboardView, string])[] = [
    ['summary', 'Resumen'],
    ['performance', 'Rendimiento'],
    ...(followUp ? ([['attendance', 'Asistencia']] as const) : []),
    ['management', 'Gestión'],
    ...(followUp ? ([['followup', 'Seguimiento']] as const) : []),
  ]
  return (
    <div
      role="group"
      aria-label="Vistas de indicadores académicos"
      data-tour="academic.views"
      className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 sm:grid-cols-3 lg:flex lg:flex-wrap"
    >
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => onChange(id)}
          className={`min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${view === id ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function AcademicDashboard({
  followUp = false,
  initialView,
}: {
  /** Suma la vista "Seguimiento": quiénes tienen notas bajas y quiénes bajaron de boletín. */
  followUp?: boolean
  initialView?: DashboardView
} = {}) {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const yearLoading = schoolYear?.loading ?? false
  const requestId = useRef(0)
  const [view, setView] = useState<DashboardView>(
    (initialView === 'followup' || initialView === 'attendance') && !followUp
      ? 'summary'
      : (initialView ?? 'summary'),
  )
  const [data, setData] = useState<Dashboard | null>(null)
  const [comparison, setComparison] = useState<ComparisonRow[]>([])
  const [comparisonError, setComparisonError] = useState<string | null>(null)
  const [dimension, setDimension] = useState<'SUBJECT' | 'COURSE' | 'YEAR'>('SUBJECT')
  const [periods, setPeriods] = useState<Period[]>([])
  const [level, setLevel] = useState<Level | null>(null)
  const [periodId, setPeriodId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const yearIds = (schoolYear?.years ?? []).map((y) => y.id).join(',')

  // Los niveles y reuniones del ciclo: ciclo básico (1 a 10) y bachillerato (1 a 12) se miran por separado.
  useEffect(() => {
    if (yearLoading) return
    let cancelled = false
    setPeriodId('')
    setPeriods([])
    api<{ data: Period[] }>(withSchoolYear('/admin/gradebook/periods', query))
      .then((res) => {
        if (!cancelled) setPeriods(res.data)
      })
      .catch(() => {
        if (!cancelled) setPeriods([])
      })
    return () => {
      cancelled = true
    }
  }, [query, yearLoading])

  const levels = availableLevels(periods)
  const activeLevel = level && levels.includes(level) ? level : levels[0]

  const load = useCallback(async () => {
    const current = ++requestId.current
    setLoading(true)
    if (yearLoading) return
    setError(null)
    setComparisonError(null)
    try {
      const filters = dashboardQuery(activeLevel, periodId)
      const years = dimension === 'YEAR' && yearIds ? `&schoolYearIds=${yearIds}` : ''
      const [dashboard, comp] = await Promise.all([
        api<Dashboard>(withSchoolYear(`/admin/academic-analytics/dashboard?${filters}`, query)),
        api<{ data: ComparisonRow[] }>(
          withSchoolYear(
            `/admin/academic-analytics/comparison?dimension=${dimension}&${filters}${years}`,
            query,
          ),
        ).catch(() => {
          if (current === requestId.current)
            setComparisonError(
              'No se pudo cargar la comparativa. El resto de los indicadores está disponible.',
            )
          return { data: [] }
        }),
      ])
      if (current !== requestId.current) return
      setData(dashboard)
      setComparison(comp.data)
    } catch (err) {
      if (current !== requestId.current) return
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los indicadores')
    } finally {
      if (current === requestId.current) setLoading(false)
    }
  }, [query, dimension, activeLevel, periodId, yearIds, yearLoading])

  const cancelPendingLoad = useCallback(() => {
    requestId.current++
  }, [])

  useEffect(() => {
    void load()
    return cancelPendingLoad
  }, [load, cancelPendingLoad])

  // El seguimiento tiene su propio selector de boletín: no depende de que cargue el tablero.
  if (view === 'followup' || view === 'attendance') {
    return (
      <div className="space-y-6">
        <ViewSwitcher view={view} onChange={setView} followUp={followUp} />
        {view === 'attendance' ? <AttendanceOverview /> : <GradeFollowUp />}
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <ViewSwitcher view={view} onChange={setView} followUp={followUp} />
        <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Calculando indicadores…
        </p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-5">
        <ViewSwitcher view={view} onChange={setView} followUp={followUp} />
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          <p>{error ?? 'No se pudieron cargar los indicadores'}</p>
          <button type="button" onClick={() => void load()} className="mt-2 font-medium underline">
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  const { students, performance, management } = data
  const levelPeriods = periods.filter((p) => !p.level || p.level === activeLevel)
  const reference = data.referencePeriod?.name

  return (
    <div className="space-y-6">
      <div
        data-tour="academic.filters"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
      >
        <div
          role="radiogroup"
          aria-label="Nivel"
          className="flex overflow-hidden rounded-lg border border-gray-300 text-sm"
        >
          {levels.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={activeLevel === item}
              onClick={() => {
                setLevel(item)
                setPeriodId('')
              }}
              className={`px-3 py-1.5 ${activeLevel === item ? 'bg-emerald-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {LEVEL_LABELS[item]}
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-600">Reunión</span>
          <select
            className="select-field"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
          >
            <option value="">La última con notas</option>
            {levelPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-gray-600">
          {reference ? `Notas de reunión (R) de ${reference}` : 'Todavía no hay notas de reunión'}
          {data.scale?.name ? ` · ${data.scale.name}` : ''}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Actualizar indicadores
        </button>
      </div>

      <ViewSwitcher view={view} onChange={setView} followUp={followUp} />
      {loading ? (
        <p role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Actualizando indicadores…
        </p>
      ) : (
        view === 'summary' && (
          <StudentOverview
            students={students}
            onPerformance={() => setView('performance')}
            onFollowUp={followUp ? () => setView('followup') : undefined}
          />
        )
      )}

      {!loading && view === 'performance' && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Rendimiento</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat
              label="Promedio general"
              value={formatHundredths(performance.averageHundredths, 1)}
            />
            <Stat label="Mediana" value={formatHundredths(performance.medianHundredths, 1)} />
            <Stat label="Resultados con nota" value={performance.gradedCount} />
          </div>

          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
            <h3 className="mb-2 text-xs uppercase tracking-wide text-gray-500">
              Distribución de calificaciones
            </h3>
            {performance.gradedCount === 0 ? (
              <p className="py-6 text-sm text-gray-500">
                Todavía no hay calificaciones cerradas en el filtro elegido.
              </p>
            ) : (
              <>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={performance.distribution}
                      margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(value, _name, item: any) => [
                          `${value} (${item.payload.percentage}%)`,
                          'Resultados',
                        ]}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {performance.distribution.map((bucket) => (
                          <Cell
                            key={bucket.levelId}
                            fill={BAR_COLORS[bucket.colorToken ?? ''] ?? '#9ca3af'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* El gráfico no puede ser la única lectura: la tabla lo hace accesible sin color. */}
                <table className="mt-3 w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="py-1 text-left font-medium">
                        Tramo
                      </th>
                      <th scope="col" className="py-1 text-left font-medium">
                        Resultados
                      </th>
                      <th scope="col" className="py-1 text-left font-medium">
                        Porcentaje
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {performance.distribution.map((bucket) => (
                      <tr key={bucket.levelId}>
                        <td className="py-1 text-gray-900">
                          {bucket.label}
                          {bucket.isAlert && (
                            <span className="ml-1 text-xs text-red-700">▲ alerta</span>
                          )}
                        </td>
                        <td className="py-1 text-gray-700">{bucket.count}</td>
                        <td className="py-1 text-gray-700">{bucket.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </section>
      )}

      {!loading && view === 'management' && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Gestión de libretas</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Incompletas" value={management.incomplete} />
            <Stat label="Cierres pendientes" value={management.pendingClosures} />
            <Stat label="Visados pendientes" value={management.pendingEndorsements} />
            <Stat
              label="Visadas"
              value={`${management.endorsedPercentage}%`}
              hint={`${management.lateClosures} cierre(s) fuera de plazo`}
            />
          </div>
          <div className="mt-4">
            <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Avance de las libretas</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  { label: 'Con notas registradas', value: management.startedPercentage },
                  { label: 'Con visado', value: management.endorsedPercentage },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                      <span>{item.label}</span>
                      <strong className="text-slate-800">{item.value}%</strong>
                    </div>
                    <div
                      role="img"
                      aria-label={`${item.label}: ${item.value}%`}
                      className="h-2.5 overflow-hidden rounded-full bg-slate-100"
                    >
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <SettingsDetails title="Más cifras de libretas">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Libretas" value={management.gradeBooks} />
                <Stat label="Completas" value={management.complete} />
              </div>
            </SettingsDetails>
          </div>
        </section>
      )}

      {!loading && view === 'performance' && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Comparativa</h2>
            <select
              value={dimension}
              onChange={(e) => setDimension(e.target.value as typeof dimension)}
              aria-label="Dimensión de comparación"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="SUBJECT">Por asignatura</option>
              <option value="COURSE">Por curso</option>
              <option value="YEAR">Por año lectivo</option>
            </select>
          </div>

          {comparisonError ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            >
              {comparisonError}
              <button
                type="button"
                onClick={() => void load()}
                className="ml-2 font-semibold underline"
              >
                Reintentar comparativa
              </button>
            </div>
          ) : comparison.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
              No hay calificaciones cerradas para comparar.
            </p>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Concentración de resultados en alerta
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Porcentaje de resultados en la banda de alerta de la escala. Ordenados de mayor a
                  menor; consultá también cuántos resultados tiene cada grupo.
                </p>
                <div
                  className="mt-4"
                  style={{ height: Math.max(220, comparison.length * 42) }}
                  role="img"
                  aria-label="Comparación del porcentaje de resultados en alerta"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[...comparison].sort((a, b) => b.alertPercentage - a.alertPercentage)}
                      layout="vertical"
                      margin={{ left: 0, right: 20 }}
                      accessibilityLayer
                    >
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value) => [`${value}%`, 'Resultados en alerta']} />
                      <Bar
                        isAnimationActive={false}
                        dataKey="alertPercentage"
                        fill="#f59e0b"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={22}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {comparison.map((row) => (
                  <li
                    key={row.key}
                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <h3 className="text-sm font-semibold text-slate-900">{row.label}</h3>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">Promedio</dt>
                        <dd>{formatHundredths(row.averageHundredths, 1)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">En alerta</dt>
                        <dd>{row.alertPercentage}%</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-slate-500">
                      {row.studentCount} estudiantes · {row.gradedCount} resultados con nota
                    </p>
                    <SettingsDetails title={`Detalles de ${row.label}`}>
                      <p className="text-xs text-slate-500">
                        Mediana: {formatHundredths(row.medianHundredths, 1)} · {row.studentCount}{' '}
                        estudiantes · {row.gradedCount} resultados con nota
                      </p>
                    </SettingsDetails>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <SettingsDetails title="Sobre estos indicadores">
        <p className="text-sm text-slate-600">{data.disclaimer}</p>
      </SettingsDetails>
    </div>
  )
}
