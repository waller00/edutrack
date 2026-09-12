'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { formatHundredths } from '@/lib/academic-config/grade-value'

type Bucket = { levelId: string; label: string; colorToken: string | null; isAlert: boolean; count: number; percentage: number }

type Dashboard = {
  students: { total: number; evaluated: number; withoutAssessments: number; atRisk: number; improved: number; declined: number }
  performance: { averageHundredths: number | null; medianHundredths: number | null; distribution: Bucket[]; gradedCount: number }
  management: {
    gradeBooks: number; complete: number; incomplete: number; pendingClosures: number
    pendingEndorsements: number; endorsedPercentage: number; lateClosures: number; startedPercentage: number
  }
  disclaimer: string
}

type ComparisonRow = {
  key: string; label: string; averageHundredths: number | null; medianHundredths: number | null
  gradedCount: number; studentCount: number; alertPercentage: number
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

export default function AcademicDashboard() {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [data, setData] = useState<Dashboard | null>(null)
  const [comparison, setComparison] = useState<ComparisonRow[]>([])
  const [dimension, setDimension] = useState<'SUBJECT' | 'COURSE' | 'YEAR'>('SUBJECT')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [dashboard, comp] = await Promise.all([
        api<Dashboard>(withSchoolYear('/admin/academic-analytics/dashboard', query)),
        api<{ data: ComparisonRow[] }>(
          withSchoolYear(`/admin/academic-analytics/comparison?dimension=${dimension}`, query),
        ),
      ])
      setData(dashboard)
      setComparison(comp.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los indicadores')
    } finally {
      setLoading(false)
    }
  }, [query, dimension])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Calculando indicadores…
      </p>
    )
  }

  if (error || !data) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {error ?? 'No se pudieron cargar los indicadores'}
      </p>
    )
  }

  const { students, performance, management } = data

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Estudiantes</h2>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Total" value={students.total} />
          <Stat label="Evaluados" value={students.evaluated} />
          <Stat label="Sin evaluaciones" value={students.withoutAssessments} />
          <Stat label="En alerta" value={students.atRisk} />
          <Stat label="Con mejora" value={students.improved} />
          <Stat label="En descenso" value={students.declined} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Rendimiento</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Promedio general" value={formatHundredths(performance.averageHundredths, 1)} />
          <Stat label="Mediana" value={formatHundredths(performance.medianHundredths, 1)} />
          <Stat label="Resultados con nota" value={performance.gradedCount} />
        </div>

        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-gray-500">Distribución de calificaciones</h3>
          {performance.gradedCount === 0 ? (
            <p className="py-6 text-sm text-gray-500">Todavía no hay calificaciones cerradas en el filtro elegido.</p>
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={performance.distribution} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(value, _name, item: any) => [`${value} (${item.payload.percentage}%)`, 'Resultados']}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {performance.distribution.map((bucket) => (
                        <Cell key={bucket.levelId} fill={BAR_COLORS[bucket.colorToken ?? ''] ?? '#9ca3af'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* El gráfico no puede ser la única lectura: la tabla lo hace accesible sin color. */}
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="py-1 text-left font-medium">Tramo</th>
                    <th scope="col" className="py-1 text-left font-medium">Resultados</th>
                    <th scope="col" className="py-1 text-left font-medium">Porcentaje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {performance.distribution.map((bucket) => (
                    <tr key={bucket.levelId}>
                      <td className="py-1 text-gray-900">
                        {bucket.label}
                        {bucket.isAlert && <span className="ml-1 text-xs text-red-700">▲ alerta</span>}
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

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Gestión de libretas</h2>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Libretas" value={management.gradeBooks} />
          <Stat label="Completas" value={management.complete} />
          <Stat label="Incompletas" value={management.incomplete} />
          <Stat label="Cierres pendientes" value={management.pendingClosures} />
          <Stat label="Visados pendientes" value={management.pendingEndorsements} />
          <Stat label="Visadas" value={`${management.endorsedPercentage}%`} hint={`${management.lateClosures} cierre(s) fuera de plazo`} />
        </div>
      </section>

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

        {comparison.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
            No hay calificaciones cerradas para comparar.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    {dimension === 'SUBJECT' ? 'Asignatura' : dimension === 'COURSE' ? 'Curso' : 'Ciclo'}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Promedio</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Mediana</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Estudiantes</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">% en alerta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {comparison.map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-1.5 text-gray-900">{row.label}</td>
                    <td className="px-3 py-1.5 text-gray-700">{formatHundredths(row.averageHundredths, 1)}</td>
                    <td className="px-3 py-1.5 text-gray-700">{formatHundredths(row.medianHundredths, 1)}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.studentCount}</td>
                    <td className="px-3 py-1.5 text-gray-700">{row.alertPercentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{data.disclaimer}</p>
    </div>
  )
}
