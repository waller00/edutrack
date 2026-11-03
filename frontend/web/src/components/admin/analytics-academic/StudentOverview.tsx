'use client'

import {
  ArrowRight,
  BookOpenCheck,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
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
import { percentage } from '@/lib/admin/student-indicators'

type Students = {
  total: number
  evaluated: number
  withoutAssessments: number
  atRisk: number
  improved: number
  declined: number
}

export default function StudentOverview({
  students,
  onFollowUp,
  onPerformance,
}: {
  students: Students
  onFollowUp?: () => void
  onPerformance: () => void
}) {
  const coverage = percentage(students.evaluated, students.total)
  const alert = percentage(students.atRisk, students.total)
  const evolution = [
    { label: 'Con mejora', count: students.improved, color: '#059669' },
    { label: 'En descenso', count: students.declined, color: '#e11d48' },
    {
      label: 'Sin cambio o sin comparación',
      count: Math.max(0, students.total - students.improved - students.declined),
      color: '#cbd5e1',
    },
  ]
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Estudiantes</h2>
        <span className="text-xs text-slate-500">Cohorte del nivel seleccionado</span>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: 'Total',
            value: students.total,
            hint: 'Estudiantes en el alcance consultado',
            Icon: Users,
            tone: 'text-slate-700 bg-slate-50',
          },
          {
            label: 'Evaluados',
            value: students.evaluated,
            hint:
              coverage === null
                ? 'Sin estudiantes en el filtro'
                : `${String(coverage).replace('.', ',')}% con evaluaciones registradas`,
            Icon: BookOpenCheck,
            tone: 'text-emerald-700 bg-emerald-50',
          },
          {
            label: 'Sin evaluaciones',
            value: students.withoutAssessments,
            hint: 'Revisar la carga de actividades',
            Icon: TrendingDown,
            tone: 'text-amber-700 bg-amber-50',
          },
          {
            label: 'En alerta',
            value: students.atRisk,
            hint:
              alert === null
                ? 'Sin estudiantes en el filtro'
                : `${String(alert).replace('.', ',')}% según las reglas del ciclo`,
            Icon: ShieldAlert,
            tone: 'text-rose-700 bg-rose-50',
          },
        ].map(({ label, value, hint, Icon, tone }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <span className={`rounded-lg p-2 ${tone}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
            </div>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
            <p className="mt-2 text-xs text-slate-500">{hint}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section
          className="rounded-2xl border border-slate-200 bg-white p-5"
          aria-label="Cobertura de evaluaciones"
        >
          <h3 className="text-sm font-semibold text-slate-900">Cobertura de evaluaciones</h3>
          <p className="mt-1 text-xs text-slate-500">
            Estudiantes con al menos una evaluación registrada hasta la reunión de referencia.
          </p>
          <div className="mt-6 flex items-baseline gap-2">
            <p className="text-4xl font-semibold tracking-tight text-emerald-700">
              {coverage === null ? '—' : `${String(coverage).replace('.', ',')}%`}
            </p>
            <span className="text-xs text-slate-500">del total del nivel</span>
          </div>
          <div
            role="img"
            aria-label={`${students.evaluated} evaluados y ${students.withoutAssessments} sin evaluaciones`}
            className="mt-4 flex h-5 overflow-hidden rounded-full bg-slate-100"
          >
            <span
              className="bg-emerald-500 transition-all"
              style={{ width: `${coverage ?? 0}%` }}
            />
            <span
              className="bg-amber-300"
              style={{ width: `${coverage === null ? 0 : 100 - coverage}%` }}
            />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Con evaluaciones</dt>
              <dd className="mt-1 font-semibold text-emerald-700">{students.evaluated}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Pendientes de evaluación</dt>
              <dd className="mt-1 font-semibold text-amber-700">{students.withoutAssessments}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={onPerformance}
            className="mt-6 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-emerald-700 hover:underline"
          >
            Explorar calificaciones
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </section>
        <section
          className="rounded-2xl border border-slate-200 bg-white p-5"
          aria-label="Evolución de los estudiantes"
        >
          <h3 className="text-sm font-semibold text-slate-900">Evolución de los estudiantes</h3>
          <p className="mt-1 text-xs text-slate-500">
            Tendencia de las notas oficiales entre reuniones disponibles.
          </p>
          {students.total ? (
            <div
              className="mt-4 h-44"
              role="img"
              aria-label={evolution.map((row) => `${row.label}: ${row.count}`).join('. ')}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={evolution}
                  layout="vertical"
                  margin={{ left: 0, right: 20 }}
                  accessibilityLayer
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" width={126} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value) => [value, 'Estudiantes']} />
                  <Bar
                    isAnimationActive={false}
                    dataKey="count"
                    radius={[0, 5, 5, 0]}
                    maxBarSize={22}
                  >
                    {evolution.map((row) => (
                      <Cell key={row.label} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-sm text-slate-500">
              No hay estudiantes en el filtro seleccionado.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              Con mejora: <strong>{students.improved}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 text-rose-700">
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
              En descenso: <strong>{students.declined}</strong>
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Sin cambio o sin comparación: {evolution[2].count}. La ausencia de comparación no indica
            una mejora ni un descenso.
          </p>
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Qué conviene revisar</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {students.total === 0
              ? 'Todavía no hay estudiantes para analizar en este alcance.'
              : `${students.atRisk} en alerta y ${students.declined} en descenso. Revisá también los ${students.withoutAssessments} sin evaluaciones antes de interpretar el rendimiento.`}
          </p>
        </div>
        {onFollowUp && (
          <button
            type="button"
            onClick={onFollowUp}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-amber-50"
          >
            Abrir seguimiento
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </section>
  )
}
