'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, CheckCircle2, Loader2, RefreshCw, Search } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import {
  attendanceByCourse,
  attendancePriorities,
  matchesStudent,
  type AbsenceStreak,
  type AbsenceThreshold,
} from '@/lib/admin/student-indicators'
import {
  absencesText,
  shortDate,
  studentName,
  Table,
  useSchoolYearQuery,
  type StudentRef,
} from '@/components/admin/student-reports/shared'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'

type View = 'prioridad' | 'seguidas' | 'faltas'
const VIEWS = [
  { id: 'prioridad', label: 'Prioridad de seguimiento' },
  { id: 'seguidas', label: 'Faltas seguidas' },
  { id: 'faltas', label: '18 y 25 faltas' },
] as const

export default function AttendanceOverview({
  initialView = 'prioridad',
  onViewChange,
}: {
  initialView?: View
  onViewChange?: (view: View) => void
}) {
  const query = useSchoolYearQuery()
  const yearLoading = useOptionalAdminSchoolYear()?.loading ?? false
  const canRead = hasPermission(useOptionalAuth()?.me, 'student-attendance.read', 'all')
  const [snapshot, setSnapshot] = useState<{
    query: string
    streaks: AbsenceStreak[]
    thresholds: AbsenceThreshold[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [filters, setFilters] = useState({ query, course: '', search: '' })
  const [view, setView] = useState<View>(initialView)
  const [limit, setLimit] = useState(20)
  const tabsId = useId()
  const course = filters.query === query ? filters.course : ''
  const search = filters.query === query ? filters.search : ''

  useEffect(() => {
    setView(initialView)
  }, [initialView])
  useEffect(() => {
    if (yearLoading) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      api<{ data: AbsenceStreak[] }>(
        withSchoolYear('/admin/student-reports/absence-streaks', query),
      ),
      api<{ data: AbsenceThreshold[] }>(
        withSchoolYear('/admin/student-reports/absence-thresholds', query),
      ),
    ])
      .then(([streaks, thresholds]) => {
        if (!cancelled) setSnapshot({ query, streaks: streaks.data, thresholds: thresholds.data })
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'No se pudieron cargar las alertas de asistencia',
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, reload, yearLoading])

  const streaks = snapshot?.query === query ? snapshot.streaks : []
  const thresholds = snapshot?.query === query ? snapshot.thresholds : []
  const courses = [...new Set([...streaks, ...thresholds].map((row) => row.courseName))].sort(
    (a, b) => a.localeCompare(b, 'es'),
  )
  const include = (row: StudentRef) =>
    (!course || row.courseName === course) && matchesStudent(row, search)
  const filteredStreaks = streaks.filter(include)
  const filteredThresholds = thresholds.filter(include)
  const priorities = attendancePriorities(filteredStreaks, filteredThresholds)
  const byCourse = attendanceByCourse(filteredStreaks, filteredThresholds).filter(
    (row) => row.active + row.warning + row.critical > 0,
  )
  const activeCount = new Set(filteredStreaks.filter((row) => row.open).map((row) => row.studentId))
    .size
  const criticalCount = filteredThresholds.filter((row) => row.absenceHundredths >= 2500).length
  const rows =
    view === 'prioridad' ? priorities : view === 'seguidas' ? filteredStreaks : filteredThresholds
  const visibleCount = Math.min(rows.length, limit)
  // Reiniciar la página al filtrar evita que una búsqueda quede escondida en páginas anteriores.
  const filterKey = `${query}|${course}|${search}|${view}`
  useEffect(() => {
    setLimit(20)
  }, [filterKey])
  const chartDescription = byCourse
    .map(
      (row) =>
        `${row.course}: ${row.active} con racha activa, ${row.warning} con 18 a menos de 25 faltas y ${row.critical} con 25 o más`,
    )
    .join('. ')

  function studentCell(student: StudentRef) {
    return canRead ? (
      <Link
        href={withSchoolYear(
          `/admin/student-attendance?studentId=${encodeURIComponent(student.studentId)}`,
          query,
        )}
        className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
      >
        {studentName(student)}
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </Link>
    ) : (
      studentName(student)
    )
  }

  return (
    <section className="space-y-5" aria-label="Panorama de asistencia">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Asistencia y seguimiento
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Alertas del ciclo lectivo completo. Detectá rachas activas y acumulación de faltas, y
            abrí la ficha para dar seguimiento.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || yearLoading}
          onClick={() => setReload((n) => n + 1)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Actualizar asistencia
        </button>
      </header>
      {canRead && (
        <Link
          href={withSchoolYear('/admin/student-attendance', query)}
          className="inline-flex text-sm font-medium text-emerald-700 hover:underline"
        >
          Ir a asistencia por estudiante →
        </Link>
      )}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          <button
            type="button"
            className="ml-3 font-semibold underline"
            onClick={() => setReload((n) => n + 1)}
          >
            Reintentar
          </button>
        </div>
      ) : loading || yearLoading || snapshot?.query !== query ? (
        <p role="status" className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Calculando asistencia…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <label className="min-w-0 flex-1 sm:min-w-48">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Buscar estudiante o curso
              </span>
              <span className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setFilters({ query, course, search: e.target.value })}
                  className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm"
                  placeholder="Nombre, apellido o curso"
                />
              </span>
            </label>
            <label className="w-full sm:w-56">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Curso</span>
              <select
                value={course}
                onChange={(e) => setFilters({ query, search, course: e.target.value })}
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm"
              >
                <option value="">Todos los cursos</option>
                {courses.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            {(search || course) && (
              <button
                type="button"
                onClick={() => setFilters({ query, search: '', course: '' })}
                className="min-h-10 px-2 text-xs font-medium text-emerald-700"
              >
                Limpiar filtros
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              {
                label: 'Necesitan seguimiento',
                value: priorities.length,
                hint: 'Estudiantes únicos con alertas actuales',
                color: 'text-slate-900',
              },
              {
                label: 'Con racha activa',
                value: activeCount,
                hint: '3 o más días seguidos sin justificar',
                color: 'text-amber-700',
              },
              {
                label: 'Con 18 faltas o más',
                value: filteredThresholds.length,
                hint: 'Incluye a quienes llegaron a 25',
                color: 'text-amber-700',
              },
              {
                label: 'Con 25 faltas o más',
                value: criticalCount,
                hint: 'Dentro del grupo de 18 o más',
                color: 'text-rose-700',
              },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                <p className={`mt-2 text-3xl font-semibold tabular-nums ${stat.color}`}>
                  {stat.value}
                </p>
                <p className="mt-1 text-xs text-slate-500">{stat.hint}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Alertas de asistencia por curso
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Cantidad de estudiantes. Una racha activa puede coincidir con un umbral de faltas.
            </p>
            {byCourse.length ? (
              <>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
                  {[
                    ['#0d9488', 'Racha activa'],
                    ['#f59e0b', '18 a menos de 25 faltas'],
                    ['#e11d48', '25 faltas o más'],
                  ].map(([color, label]) => (
                    <span key={label} className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ background: color }}
                        aria-hidden
                      />
                      {label}
                    </span>
                  ))}
                </div>
                <div
                  className="mt-4 w-full"
                  style={{ height: Math.max(220, byCourse.length * 70) }}
                  aria-label="Gráfica de alertas por curso"
                  role="img"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={byCourse}
                      layout="vertical"
                      margin={{ left: 0, right: 20, top: 8, bottom: 8 }}
                      accessibilityLayer
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="course" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} />
                      <Bar
                        isAnimationActive={false}
                        name="Racha activa"
                        dataKey="active"
                        fill="#0d9488"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={14}
                      />
                      <Bar
                        isAnimationActive={false}
                        name="18 a menos de 25 faltas"
                        dataKey="warning"
                        fill="#f59e0b"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={14}
                      />
                      <Bar
                        isAnimationActive={false}
                        name="25 faltas o más"
                        dataKey="critical"
                        fill="#e11d48"
                        radius={[0, 4, 4, 0]}
                        maxBarSize={14}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="sr-only">{chartDescription}</p>
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium">Ver datos de la gráfica</summary>
                  <Table
                    head={['Curso', 'Racha activa', '18 a menos de 25', '25 o más']}
                    minWidth={480}
                  >
                    {byCourse.map((row) => (
                      <tr key={row.course}>
                        <td className="px-3 py-2">{row.course}</td>
                        <td className="px-3 py-2">{row.active}</td>
                        <td className="px-3 py-2">{row.warning}</td>
                        <td className="px-3 py-2">{row.critical}</td>
                      </tr>
                    ))}
                  </Table>
                </details>
              </>
            ) : (
              <p className="flex items-center gap-2 py-8 text-sm text-slate-500">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
                {search || course
                  ? 'No hay alertas actuales con estos filtros.'
                  : 'No se detectaron alertas actuales en las listas registradas.'}
              </p>
            )}
          </div>
          <div className="space-y-3" data-tour="attendance-indicators.list">
            <div
              role="tablist"
              aria-label="Indicadores de asistencia de estudiantes"
              data-tour="attendance-indicators.tabs"
              onKeyDown={(event) => {
                const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                if (!step && event.key !== 'Home' && event.key !== 'End') return
                event.preventDefault()
                const index =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? VIEWS.length - 1
                      : (VIEWS.findIndex((tab) => tab.id === view) + step + VIEWS.length) %
                        VIEWS.length
                const next = VIEWS[index].id
                setView(next)
                onViewChange?.(next)
                document.getElementById(`${tabsId}-${next}`)?.focus()
              }}
              className="flex flex-wrap gap-1 border-b border-slate-200"
            >
              {VIEWS.map((tab) => (
                <button
                  key={tab.id}
                  id={`${tabsId}-${tab.id}`}
                  tabIndex={view === tab.id ? 0 : -1}
                  type="button"
                  role="tab"
                  aria-selected={view === tab.id}
                  aria-controls={`${tabsId}-results`}
                  onClick={() => {
                    setView(tab.id)
                    onViewChange?.(tab.id)
                  }}
                  className={`min-h-11 border-b-2 px-3 text-sm font-medium ${view === tab.id ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              id={`${tabsId}-results`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-${view}`}
              className="space-y-3"
            >
              <p className="text-xs text-slate-500">
                {view === 'prioridad'
                  ? 'Primero quienes combinan alertas; después, mayor acumulación de faltas y duración de la racha. Cada estudiante aparece una vez.'
                  : view === 'seguidas'
                    ? 'Historial de rachas de 3 o más días de clase con falta entera sin justificar. Fines de semana y feriados no cortan la racha.'
                    : 'Acumulado de faltas del ciclo. Las fracciones de falta se conservan.'}
              </p>
              {rows.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                  No hay estudiantes para mostrar con estos filtros.
                </p>
              ) : (
                <>
                  <p aria-live="polite" className="text-xs text-slate-500">
                    Mostrando {visibleCount} de {rows.length}{' '}
                    {view === 'seguidas' ? 'rachas' : 'estudiantes'}
                  </p>
                  {view === 'prioridad' ? (
                    <Table
                      head={[
                        'Estudiante',
                        'Curso',
                        'Motivos de seguimiento',
                        'Faltas del ciclo',
                        'Racha activa',
                      ]}
                    >
                      {priorities.slice(0, limit).map((row) => (
                        <tr key={row.studentId}>
                          <td className="px-3 py-3">{studentCell(row)}</td>
                          <td className="px-3 py-3">{row.courseName}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {row.reasons.map((reason) => (
                                <span
                                  key={reason}
                                  className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900"
                                >
                                  {reason}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-3 tabular-nums">
                            {row.absenceHundredths === null
                              ? 'Sin alerta de umbral'
                              : absencesText(row.absenceHundredths)}
                          </td>
                          <td className="px-3 py-3 tabular-nums">
                            {row.streakDays ? `${row.streakDays} días` : '—'}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  ) : view === 'seguidas' ? (
                    <Table head={['Estudiante', 'Curso', 'Desde', 'Hasta', 'Días', 'Estado']}>
                      {filteredStreaks.slice(0, limit).map((row) => (
                        <tr key={`${row.studentId}-${row.from}`}>
                          <td className="px-3 py-3">{studentCell(row)}</td>
                          <td className="px-3 py-3">{row.courseName}</td>
                          <td className="px-3 py-3">{shortDate(row.from)}</td>
                          <td className="px-3 py-3">{shortDate(row.to)}</td>
                          <td className="px-3 py-3">{row.days}</td>
                          <td className="px-3 py-3">
                            <span
                              className={row.open ? 'font-medium text-rose-700' : 'text-slate-500'}
                            >
                              {row.open ? 'Sigue faltando' : 'Racha cortada'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </Table>
                  ) : (
                    <Table
                      head={['Estudiante', 'Curso', 'Faltas del ciclo', 'Umbral']}
                      minWidth={480}
                    >
                      {filteredThresholds.slice(0, limit).map((row) => (
                        <tr key={row.studentId}>
                          <td className="px-3 py-3">{studentCell(row)}</td>
                          <td className="px-3 py-3">{row.courseName}</td>
                          <td className="px-3 py-3 tabular-nums">
                            {absencesText(row.absenceHundredths)}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`rounded-md px-2 py-1 text-xs font-semibold ${row.absenceHundredths >= 2500 ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}
                            >
                              {row.absenceHundredths >= 2500 ? '25+' : '18+'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </Table>
                  )}
                  {visibleCount < rows.length && (
                    <button
                      type="button"
                      onClick={() => setLimit((n) => n + 20)}
                      className="min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600"
                    >
                      Mostrar 20 más
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Estos indicadores se calculan sobre las listas registradas del ciclo. No representan una
            tasa general de asistencia. Una racha cortada queda en el historial y deja de contar
            como alerta activa.
          </p>
        </>
      )}
    </section>
  )
}
