'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarDays, CheckCircle2, CircleDashed, Clock3, Loader2, Receipt, Search, Users } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import PaginationControls from '@/components/common/PaginationControls'
import TuitionRoster from '@/components/admin/tuition/TuitionRoster'
import TuitionStudentPanel from '@/components/admin/tuition/TuitionStudentPanel'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { api } from '@/lib/api/client'
import { MONTH_NAMES, TUITION_STATUS_LABELS, formatTuitionAmount, type TuitionList, type TuitionStatus, type TuitionStudent } from '@/lib/admin/tuition'

const PAGE_SIZE = 20
const FILTERS = [{ id: 'all', label: 'Todos' }, ...(['pending', 'paid', 'none'] as const).map((id) => ({ id, label: TUITION_STATUS_LABELS[id] }))] as const

export default function AdminTuitionPage() {
  const schoolYear = useOptionalAdminSchoolYear()
  const selectedYear = schoolYear?.years.find((item) => item.id === (schoolYear.selectedId ?? schoolYear.activeId))?.code
  return <RoleGuard allow={[]} permission="students.manage" permissionScope="all">
    {schoolYear?.loading ? <div role="status" className="responsive-page flex items-center gap-2 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />Cargando mensualidades…</div> : <TuitionWorkspace initialYear={selectedYear ?? new Date().getFullYear()} />}
  </RoleGuard>
}

function TuitionWorkspace({ initialYear }: { initialYear: number }) {
  const schoolYear = useOptionalAdminSchoolYear()
  const now = new Date()
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [query, setQuery] = useState('')
  const [courseId, setCourseId] = useState('')
  const [status, setStatus] = useState<TuitionStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<TuitionList | null>(null)
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [courseError, setCourseError] = useState('')
  const [courseRevision, setCourseRevision] = useState(0)
  const [panel, setPanel] = useState<{ student: TuitionStudent; register: boolean } | null>(null)
  const debouncedQuery = useDebouncedValue(query, 300)
  const years = [...new Set([year, now.getFullYear(), ...(schoolYear?.years.map((item) => item.code) ?? [])])].sort((a, b) => b - a)
  const cycleId = schoolYear?.years.find((item) => item.code === year)?.id
  const hasSchoolYearContext = Boolean(schoolYear)

  useEffect(() => {
    let cancelled = false
    setCourses([]); setCourseError('')
    if (hasSchoolYearContext && !cycleId) return
    void api<{ id: string; name: string }[]>(`/courses${cycleId ? `?schoolYearId=${encodeURIComponent(cycleId)}` : ''}`).then((data) => {
      if (!cancelled) setCourses(Array.isArray(data) ? data : [])
    }).catch(() => { if (!cancelled) setCourseError('No se pudieron cargar los cursos.') })
    return () => { cancelled = true }
  }, [cycleId, courseRevision, hasSchoolYearContext])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    const params = new URLSearchParams({ year: String(year), month: String(month), page: String(page), pageSize: String(PAGE_SIZE), status })
    if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim())
    if (courseId) params.set('courseId', courseId)
    void api<TuitionList>(`/admin/tuition?${params}`).then((data) => {
      if (cancelled) return
      if (page > 1 && (page - 1) * PAGE_SIZE >= data.total) { setPage(Math.max(1, Math.ceil(data.total / PAGE_SIZE))); return }
      setResult(data)
    }).catch((err) => {
      if (!cancelled) { setError(err instanceof Error ? err.message : 'No se pudieron cargar las mensualidades.'); setResult(null) }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year, month, page, debouncedQuery, courseId, status, revision])

  const summary = loading ? null : result?.summary
  const period = `${MONTH_NAMES[month - 1]} ${year}`
  const hasFilters = Boolean(query || courseId || status !== 'all')
  function clearFilters() { setQuery(''); setCourseId(''); setStatus('all'); setPage(1) }
  function filterStatus(value: TuitionStatus | 'all') { setStatus(value); setPage(1) }

  return <main className="responsive-page max-w-[1600px] space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><Receipt className="h-6 w-6" aria-hidden /></div>
        <div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Administración de cobros</p><h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Mensualidades</h1><p className="mt-1 text-sm text-slate-500">Cada mes, cada estudiante y sus pagos en un solo lugar.</p></div>
      </div>
      <Link href="/admin/students" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-white hover:text-emerald-700"><ArrowLeft className="h-4 w-4" aria-hidden />Estudiantes</Link>
    </header>

    <section aria-label="Período de mensualidades" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-emerald-600" aria-hidden /><h2 className="text-lg font-semibold text-slate-900">{period}</h2></div>
        <div className="flex items-center gap-3">
          {(year !== now.getFullYear() || month !== now.getMonth() + 1) && <button type="button" className="text-xs font-semibold text-emerald-700 hover:underline" onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth() + 1); setCourseId(''); setPage(1) }}>Mes actual</button>}
          <label className="flex items-center gap-2 text-sm text-slate-500">Año<select aria-label="Año de mensualidades" value={year} onChange={(event) => { setYear(Number(event.target.value)); setCourseId(''); setPage(1) }} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-800">{years.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 xl:grid-cols-12" aria-label="Elegir mes">
        {MONTH_NAMES.map((name, index) => <button key={name} type="button" aria-pressed={month === index + 1} onClick={() => { setMonth(index + 1); setPage(1) }} className={`min-h-11 rounded-lg px-1 py-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${month === index + 1 ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-50 text-slate-500 hover:bg-emerald-50 hover:text-emerald-800'}`}>{name}</button>)}
      </div>
    </section>

    <section aria-label={`Resumen de ${period}`} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        { label: 'Estudiantes', count: summary?.students, detail: 'Con matrícula o cuotas en este año', Icon: Users, color: 'bg-slate-100 text-slate-600', filter: 'all' as const },
        { label: 'Pagados', count: summary?.paid, detail: `${formatTuitionAmount(summary?.collectedCents ?? 0)} cobrados`, Icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600', filter: 'paid' as const, missing: summary?.paidWithoutAmount },
        { label: 'Pendientes', count: summary?.pending, detail: `${formatTuitionAmount(summary?.pendingCents ?? 0)} por cobrar`, Icon: Clock3, color: 'bg-amber-50 text-amber-600', filter: 'pending' as const, missing: summary?.pendingWithoutAmount },
        { label: 'Sin registrar', count: summary?.none, detail: 'Todavía sin una cuota cargada', Icon: CircleDashed, color: 'bg-slate-100 text-slate-400', filter: 'none' as const },
      ].map(({ label, count, detail, Icon, color, filter, missing }) => <button key={label} type="button" aria-label={`Mostrar ${label.toLowerCase()}`} aria-pressed={status === filter} onClick={() => filterStatus(filter)} className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-emerald-400 sm:p-5 ${status === filter ? 'border-emerald-300' : 'border-slate-200'}`}>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-slate-500 sm:text-sm">{label}</span><span className={`rounded-lg p-2 ${color}`}><Icon className="h-4 w-4" aria-hidden /></span></div>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{count ?? '—'}</p>
        <p className="mt-1 text-xs text-slate-500">{summary ? detail : loading ? 'Cargando resumen…' : 'Resumen no disponible'}</p>
        {Boolean(missing) && <p className="mt-1 text-xs text-amber-700">{missing} sin importe informado</p>}
      </button>)}
    </section>

    <section aria-label={`Mensualidades de ${period}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Detalle del mes <span className="ml-2 text-sm font-normal text-slate-400">{!loading && result ? `${result.total} estudiantes` : ''}</span></h2><p className="text-xs text-slate-400">Seleccioná un estudiante para ver su año completo.</p></div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input aria-label="Buscar estudiante" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Buscar por nombre, apellido o documento…" className="input-field w-full !pl-9 text-sm" /></div>
          <select aria-label="Filtrar por curso" value={courseId} onChange={(event) => { setCourseId(event.target.value); setPage(1) }} className="select-field text-sm sm:w-52"><option value="">Todos los cursos</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
        </div>
        {courseError && <p role="alert" className="text-xs text-amber-700">{courseError} <button type="button" onClick={() => setCourseRevision((value) => value + 1)} className="underline">Reintentar</button></p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por estado de pago">{FILTERS.map((filter) => <button type="button" key={filter.id} aria-pressed={status === filter.id} onClick={() => filterStatus(filter.id)} className={`rounded-lg px-3 py-2 text-xs font-medium transition ${status === filter.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{filter.label}</button>)}</div>
          {hasFilters && <button type="button" onClick={clearFilters} className="text-xs font-medium text-emerald-700 hover:underline">Limpiar filtros</button>}
        </div>
      </div>
      {loading ? <div role="status" className="flex min-h-60 items-center justify-center gap-2 border-t border-slate-100 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden />Cargando mensualidades…</div>
        : error ? <div role="alert" className="space-y-3 border-t border-slate-100 p-10 text-center"><p className="text-sm text-red-700">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className="btn-secondary text-sm">Reintentar</button></div>
        : result?.data.length ? <TuitionRoster students={result.data} year={year} month={month} onOpen={(student, register) => setPanel({ student, register })} />
        : <div className="flex min-h-60 flex-col items-center justify-center gap-3 border-t border-slate-100 px-5 py-10 text-center"><Receipt className="h-9 w-9 text-slate-300" aria-hidden /><h3 className="font-semibold text-slate-800">{hasFilters ? 'No hay estudiantes con estos filtros' : 'Todavía no hay estudiantes en este año'}</h3><p className="max-w-md text-sm text-slate-500">{hasFilters ? 'Probá otro estado, curso o nombre para encontrar sus mensualidades.' : 'Se muestran estudiantes con matrícula o mensualidades registradas en el año seleccionado.'}</p>{hasFilters ? <button type="button" onClick={clearFilters} className="btn-secondary text-sm">Ver todos</button> : <Link href="/admin/students" className="btn-secondary text-sm">Ir a Estudiantes</Link>}</div>}
      {!loading && result && <PaginationControls page={result.page} total={result.total} pageSize={result.pageSize} onPageChange={setPage} />}
      <p className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs text-slate-400">Importes en pesos uruguayos. Los totales incluyen las cuotas con importe informado. “Sin registrar” no se considera pendiente.</p>
    </section>
    {panel && <TuitionStudentPanel student={panel.student} year={year} initialMonth={month} registerPayment={panel.register} onSaved={() => setRevision((value) => value + 1)} onClose={() => setPanel(null)} />}
  </main>
}
