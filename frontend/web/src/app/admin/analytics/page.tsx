'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import DateField from '@/components/forms/DateField'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { apiBaseUrl } from '@/lib/api/base-url'
import { getAdminEventTypeLabel } from '@/lib/admin/events-display'
import { getRiskScoreBadgeClass } from '@/lib/admin/analytics-display'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  LayoutGrid,
  Lightbulb,
  Loader2,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import TrendLineChart from '@/components/charts/TrendLineChart'
import BreakdownBarChart from '@/components/charts/BreakdownBarChart'
import StatusDonutChart from '@/components/charts/StatusDonutChart'

type OrgRoleFilter = 'ADMIN' | 'STAFF' | 'TEACHER'

const EVENT_TYPES = ['JORNADA_LABORAL', 'REUNION', 'CLASE'] as const

type AnalyticsUserOption = {
  id: string
  username?: string | null
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  orgRole?: { code?: string | null } | null
}

type DashboardMeta = {
  resolvedInstanceCount: number
  rangeFrom: string
  rangeTo: string
  roleFilter: OrgRoleFilter | null
  eventTypeFilter: string | null
  schoolYearId?: string | null
  allYears?: boolean
  generatedAt: string
}

type DashboardKpis = {
  M1_PUNCTUALITY_pct: number
  M2_LATE_RATE_pct: number
  M4_AOP_pct: number
  M6_COVERAGE_CP_pct: number
  M8_HOURS_DELTA_pct: number
  PC_count: number
}

type SeriesPoint = { period: string; value: number }

type TopRiskPerson = {
  userId: string
  displayName: string
  role: string
  plannedCount: number
  lateCount: number
  absentNotJustifiedCount: number
  absentJustifiedCount: number
  riskScore: number
}

type TopRiskEvent = {
  eventId: string
  title: string
  eventType: string
  plannedCount: number
  lateRatePct: number
  absentOverPlanPct: number
  focusScore: number
}

type BreakdownRow = {
  key: string
  label: string
  plannedCount: number
  punctualityPct: number
  lateRatePct: number
  aopPct: number
  coveragePct: number
}

type StatusDistRow = { status: string; count: number; pct: number }

type SeriesMultiPoint = { period: string; lateRate: number; aop: number; coverage: number }

type PeriodComparison = {
  previousFrom: string
  previousTo: string
  current: DashboardKpis
  previous: DashboardKpis
  deltas: DashboardKpis
}

type DashboardResponse = {
  meta?: DashboardMeta & { granularity?: SeriesGranularity }
  kpis: DashboardKpis
  series: {
    lateRateByPeriod: SeriesPoint[]
    aopByPeriod: SeriesPoint[]
  }
  seriesMulti?: SeriesMultiPoint[]
  breakdowns?: {
    byRole: BreakdownRow[]
    byEventType: BreakdownRow[]
    byCourse: BreakdownRow[]
  }
  statusDistribution?: { totalPlanned: number; rows: StatusDistRow[] }
  comparison?: PeriodComparison | null
  topLists?: {
    topRiskPeople: TopRiskPerson[]
    topRiskEvents: TopRiskEvent[]
  }
}

type SeriesGranularity = 'day' | 'week' | 'month'

const GRANULARITY_OPTIONS: { value: SeriesGranularity; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
]

function formatPct(v: number) {
  return `${v.toFixed(2)}%`
}

function userDisplayLabel(user: AnalyticsUserOption) {
  const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return user.name || fullName || user.username || user.email || 'Sin nombre'
}

function trimEdgeChars(value: string, char: string): string {
  let start = 0
  let end = value.length
  while (start < end && value[start] === char) start += 1
  while (end > start && value[end - 1] === char) end -= 1
  return value.slice(start, end)
}

function sanitizeFilenamePart(value: string) {
  return trimEdgeChars(
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_'),
    '_',
  )
    .slice(0, 48) || 'persona'
}

type KpiTone = 'emerald' | 'amber' | 'red' | 'slate'

/** Delta vs período anterior. `higherIsBetter` define el color (verde/rojo). */
function DeltaBadge({ delta, higherIsBetter, suffix = '%' }: { delta: number; higherIsBetter: boolean; suffix?: string }) {
  if (Math.abs(delta) < 0.01) {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">Sin cambios</span>
  }
  const isUp = delta > 0
  const good = isUp === higherIsBetter
  const cls = good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
  const Icon = isUp ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${cls}`} title="Variación vs período anterior">
      <Icon className="h-3 w-3" aria-hidden />
      {`${isUp ? '+' : ''}${delta.toFixed(2)}${suffix}`}
    </span>
  )
}

function KpiCard(props: {
  label: string
  hint?: string
  value: ReactNode
  foot?: string
  tone: KpiTone
  delta?: number
  deltaHigherIsBetter?: boolean
  deltaSuffix?: string
}) {
  const toneMap: Record<KpiTone, string> = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-700',
    red: 'text-red-600',
    slate: 'text-slate-900',
  }
  const { label, hint, value, foot, tone, delta, deltaHigherIsBetter, deltaSuffix } = props

  return (
    <article className="flex flex-col justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div>
        <h3 title={hint} className="text-sm font-medium text-gray-600">
          {label}
          {hint ? <span className="ml-1 cursor-help text-gray-400">ⓘ</span> : null}
        </h3>
        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <p className={`text-2xl font-bold tabular-nums tracking-tight ${toneMap[tone]}`}>{value}</p>
          {typeof delta === 'number' ? (
            <DeltaBadge delta={delta} higherIsBetter={deltaHigherIsBetter ?? true} suffix={deltaSuffix ?? '%'} />
          ) : null}
        </div>
      </div>
      {foot ? <p className="mt-3 text-xs text-gray-500">{foot}</p> : null}
    </article>
  )
}

function AnalyticsSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={`sk-${String(i)}`}
          className="h-28 animate-pulse rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-gray-100"
        />
      ))}
    </div>
  )
}

function buildDecisionSignals(d: DashboardResponse): string[] {
  const hints: string[] = []
  const { kpis } = d
  const hotPeople = (d.topLists?.topRiskPeople ?? []).filter((p) => p.riskScore > 0)
  const hotEvents = (d.topLists?.topRiskEvents ?? []).filter((e) => e.focusScore > 0)

  const n = d.meta?.resolvedInstanceCount ?? 0
  if (n >= 120) {
    hints.push(
      `Muestra institucional relevante (${n.toLocaleString('es-UY')} obligaciones registradas): las tendencias agregadas son más estables.`,
    )
  } else if (n > 0) {
    hints.push(
      `Se analizaron ${n.toLocaleString('es-UY')} obligaciones registradas para el período: interpretá deltas con mayor cautela.`,
    )
  }

  if (kpis.M4_AOP_pct >= 12) {
    hints.push(
      `Ausentismo elevado (${formatPct(kpis.M4_AOP_pct)}) sobre lo planificado: conviene revisar causas recurrentes por persona y por tipo de actividad.`,
    )
  }
  if (kpis.M2_LATE_RATE_pct >= 10) {
    hints.push(
      `Muchas llegadas después del horario (${formatPct(kpis.M2_LATE_RATE_pct)}): cruzalo con agendas publicadas y con la operación biométrica de entrada.`,
    )
  }
  if (kpis.M1_PUNCTUALITY_pct < 85 && kpis.M1_PUNCTUALITY_pct > 0) {
    hints.push(
      'Puntualidad global inferior al 85%: comunicación institucional y revisión horaria pueden ir antes que medidas formales escalonadas.',
    )
  }
  if (kpis.PC_count > 0) {
    hints.push(
      `Licencias marcadas como inactivas (${kpis.PC_count}) que solapan este período: contrastá contra ausencias justificadas y evitá falsos positivos.`,
    )
  }
  if (hotPeople.length > 0) {
    hints.push(
      'El ranking de personas consolida “tardanza + ausencias no justificadas por licencia” como trabajo de campo (RRHH/responsables), no decisión automatizada.',
    )
  }
  if (hotEvents.length > 0) {
    hints.push(
      'Los eventos con mayor fricción suelen mejorar redistribución de cargas horarias, tamaño del grupo asignado y confirmaciones previas.',
    )
  }

  if (hints.length <= 3) {
    hints.push(
      'Si los indicadores se mantienen en rangos razonables, seguí vigilando cambios entre semanas y compará períodos iguales (p. ej. mes previo).',
    )
  }

  return hints.slice(0, 8)
}

function roleChipLabel(role: string | undefined | null) {
  switch (role) {
    case 'TEACHER':
      return 'Docentes'
    case 'STAFF':
      return 'Personal'
    case 'ADMIN':
      return 'Administradores'
    case '':
    case undefined:
    case null:
      return 'Todos los roles'
    default:
      return role
  }
}

function PersonRankCard({ p, onSelect }: Readonly<{ p: TopRiskPerson; onSelect: () => void }>) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-900">{p.displayName}</div>
          <div className="text-xs text-gray-500">{roleChipLabel(p.role)}</div>
        </div>
        <span className={`inline-flex shrink-0 rounded-full px-2 py-1 text-xs font-bold tabular-nums ${getRiskScoreBadgeClass(p.riskScore)}`}>
          {p.riskScore}
        </span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <div className="flex gap-1"><dt className="text-gray-500">Oblig.:</dt><dd className="tabular-nums">{p.plannedCount}</dd></div>
        <div className="flex gap-1"><dt className="text-gray-500">Tarde:</dt><dd className="tabular-nums text-amber-800">{p.lateCount}</dd></div>
        <div className="flex gap-1"><dt className="text-gray-500">Aus NJ:</dt><dd className="tabular-nums font-medium text-red-700">{p.absentNotJustifiedCount}</dd></div>
        <div className="flex gap-1"><dt className="text-gray-500">Aus OK:</dt><dd className="tabular-nums">{p.absentJustifiedCount}</dd></div>
      </dl>
      <button
        type="button"
        className="mt-3 w-full rounded-md border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
        onClick={onSelect}
      >
        Ver detalle
      </button>
    </div>
  )
}

function EventRankCard({ e }: Readonly<{ e: TopRiskEvent }>) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-semibold text-gray-900" title={`${e.title} · ${e.eventId}`}>
          {e.title}
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-md border border-emerald-100 bg-emerald-50/70 px-2 py-1 text-[11px] font-medium uppercase text-emerald-900">
          {getAdminEventTypeLabel(e.eventType)}
        </span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <div className="flex gap-1"><dt className="text-gray-500">Oblig.:</dt><dd className="tabular-nums">{e.plannedCount}</dd></div>
        <div className="flex gap-1"><dt className="text-gray-500">% Tarde:</dt><dd className="tabular-nums text-amber-800">{formatPct(e.lateRatePct)}</dd></div>
        <div className="flex gap-1"><dt className="text-gray-500">% Aus:</dt><dd className="tabular-nums font-medium text-red-700">{formatPct(e.absentOverPlanPct)}</dd></div>
        <div className="flex gap-1"><dt className="text-gray-500">Índice:</dt><dd className="font-semibold tabular-nums text-slate-900">{e.focusScore.toFixed(2)}</dd></div>
      </dl>
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 29)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  /** Vacío = sin filtro (todos los usuarios planificados en el período). */
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [eventType, setEventType] = useState<string>('')
  // null = ninguna granularidad elegida (sin botón resaltado); las tendencias usan 'week' por defecto.
  const [granularity, setGranularity] = useState<SeriesGranularity | null>(null)
  const [users, setUsers] = useState<AnalyticsUserOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [selectedUserName, setSelectedUserName] = useState('')
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [exportingKind, setExportingKind] = useState<'xlsx' | 'csv' | 'pdf' | 'person' | 'course' | null>(null)
  const [exportNotice, setExportNotice] = useState<string>('')

  const apiUrl = apiBaseUrl()
  const analyticsSchoolYearId = syCtx?.selectedId ?? syCtx?.activeId ?? null

  // Fila del ciclo lectivo efectivamente filtrado (para derivar su rango de fechas).
  const selectedYearRow = useMemo(
    () => (analyticsSchoolYearId ? syCtx?.years.find((y) => y.id === analyticsSchoolYearId) ?? null : null),
    [syCtx?.years, analyticsSchoolYearId],
  )

  // Rango de fechas que corresponde al ciclo lectivo en foco: el dashboard debe mirar
  // el período del ciclo seleccionado, no los últimos 30 días (que suelen quedar fuera
  // de un ciclo cerrado y dejan todos los KPIs en 0). Se acota a "hoy" para ciclos en curso.
  const yearRange = useMemo<{ from: string; to: string } | null>(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (syCtx?.allYears) {
      const starts = (syCtx.years ?? [])
        .map((y) => y.startsOn?.slice(0, 10))
        .filter((v): v is string => Boolean(v))
        .sort((a, b) => a.localeCompare(b))
      if (starts.length === 0) return null
      return { from: starts[0], to: today }
    }
    const start = selectedYearRow?.startsOn?.slice(0, 10)
    if (!start) return null
    const end = selectedYearRow?.endsOn?.slice(0, 10)
    return { from: start, to: end && end < today ? end : today }
  }, [syCtx?.allYears, syCtx?.years, selectedYearRow])

  // Identidad de la selección de ciclo: cambiar de ciclo (o a "todos") re-sincroniza el rango,
  // pero ediciones manuales de fecha posteriores se respetan (no se vuelven a sobreescribir).
  const selectionKey = syCtx?.allYears ? 'ALL' : analyticsSchoolYearId
  const appliedSelectionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!yearRange || !selectionKey) return
    if (appliedSelectionRef.current === selectionKey) return
    appliedSelectionRef.current = selectionKey
    setFrom(yearRange.from)
    setTo(yearRange.to)
  }, [selectionKey, yearRange])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to, granularity: granularity ?? 'week' })
      if (selectedUserId) params.set('userId', selectedUserId)
      else if (roleFilter) params.set('role', roleFilter)
      if (eventType) params.set('eventType', eventType)
      if (syCtx?.allYears) params.set('allYears', '1')
      else if (analyticsSchoolYearId) params.set('schoolYearId', analyticsSchoolYearId)

      const data = await api<DashboardResponse>(`/analytics/dashboard?${params.toString()}`)
      setDashboard(data)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo cargar el dashboard'
      setError(msg || 'No se pudo cargar el dashboard')
    } finally {
      setLoading(false)
    }
  }, [from, to, granularity, roleFilter, selectedUserId, eventType, syCtx?.allYears, analyticsSchoolYearId])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    let active = true
    async function loadUsers() {
      try {
        const data = await api<{ data: AnalyticsUserOption[] }>('/admin/users?pageSize=200')
        if (active) setUsers(data.data)
      } catch {
        if (active) setUsers([])
      }
    }
    void loadUsers()
    return () => {
      active = false
    }
  }, [])

  const decisionSignals = useMemo(() => {
    if (!dashboard) return []
    return buildDecisionSignals(dashboard)
  }, [dashboard])

  const resolvedCount = dashboard?.meta?.resolvedInstanceCount ?? 0
  const generatedLabel = dashboard?.meta?.generatedAt
    ? new Intl.DateTimeFormat('es-UY', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23',
      }).format(new Date(dashboard.meta.generatedAt)) + ' UTC'
    : null

  const exportFilters = () => ({
    ...(selectedUserId ? { userId: selectedUserId } : roleFilter ? { role: roleFilter } : {}),
    ...(eventType ? { eventType } : {}),
    ...(syCtx?.allYears ? { allYears: '1' } : {}),
    ...(!syCtx?.allYears && analyticsSchoolYearId ? { schoolYearId: analyticsSchoolYearId } : {}),
  })

  /** Crea la exportación, espera a que termine y dispara la descarga del archivo. */
  const runExport = async (
    kind: 'xlsx' | 'csv' | 'pdf' | 'person' | 'course',
    reportKey: string,
    format: 'XLSX' | 'CSV' | 'PDF',
    filename: string,
    successMsg: string,
  ) => {
    setExportNotice('')
    setExportingKind(kind)
    setError(null)
    try {
      const body = { reportKey, format, from, to, filters: exportFilters() }
      const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(body) })
      const exportId = res.exportId

      let exportDone = false
      for (let i = 0; i < 30; i++) {
        const statusRes = await api<{ status: string; downloadUrl: string | null; errorMessage?: string }>(`/exports/${exportId}`)
        if (statusRes.status === 'DONE') {
          exportDone = true
          break
        }
        if (statusRes.status === 'FAILED') throw new Error(statusRes.errorMessage || 'Error generando exportación')
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!exportDone) throw new Error('La exportación tardó demasiado en generarse')

      const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
      if (!dl.ok) throw new Error(`Error descargando exportación: ${dl.status}`)
      const blob = await dl.blob()
      const url = globalThis.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      globalThis.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setExportNotice(successMsg)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al exportar.'
      setError(msg)
    } finally {
      setExportingKind(null)
    }
  }

  const runExportAttendance = (format: 'XLSX' | 'CSV') =>
    runExport(
      format === 'XLSX' ? 'xlsx' : 'csv',
      'attendance_detail',
      format,
      selectedUserName
        ? `EduTrack_Asistencia_detallada_${sanitizeFilenamePart(selectedUserName)}_${from}_${to}.${format === 'XLSX' ? 'xlsx' : 'csv'}`
        : `EduTrack_Asistencia_detallada_${from}_${to}.${format === 'XLSX' ? 'xlsx' : 'csv'}`,
      selectedUserName ? `✅ Detalle ${format} de ${selectedUserName} listo.` : `✅ Exportación ${format} lista.`,
    )

  const runExportMonthly = () =>
    runExport('pdf', 'monthly_summary', 'PDF', `EduTrack_Resumen_mensual_${from.slice(0, 7)}.pdf`, '✅ PDF mensual listo.')

  const runExportPerson = () =>
    runExport(
      'person',
      'person_report',
      'XLSX',
      selectedUserName
        ? `EduTrack_Reporte_persona_${sanitizeFilenamePart(selectedUserName)}_${from}_${to}.xlsx`
        : `EduTrack_Reporte_por_persona_${from}_${to}.xlsx`,
      selectedUserName ? `✅ Reporte de ${selectedUserName} listo.` : '✅ Reporte por persona listo.',
    )

  const runExportCourse = () =>
    runExport('course', 'course_report', 'XLSX', `EduTrack_Reporte_por_curso_${from}_${to}.xlsx`, '✅ Reporte por curso listo.')

  function clearFiltersAndReload() {
    // "Limpiar" vuelve al rango del ciclo lectivo en foco (no a los últimos 30 días,
    // que para un ciclo cerrado quedan fuera de su período y muestran todo en 0).
    if (yearRange) {
      setFrom(yearRange.from)
      setTo(yearRange.to)
    } else {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - 29)
      setFrom(d.toISOString().slice(0, 10))
      setTo(new Date().toISOString().slice(0, 10))
    }
    setRoleFilter('')
    setEventType('')
    setGranularity(null)
    setSelectedUserId('')
    setUserSearch('')
    setSelectedUserName('')
    setIsUserDropdownOpen(false)
    setExportNotice('')
  }

  const trendPoints =
    dashboard?.seriesMulti ??
    (dashboard
      ? dashboard.series.lateRateByPeriod.map((p, i) => ({
          period: p.period,
          lateRate: p.value,
          aop: dashboard.series.aopByPeriod[i]?.value ?? 0,
          coverage: 0,
        }))
      : [])
  const peopleRank = dashboard?.topLists?.topRiskPeople ?? []
  const eventsRank = dashboard?.topLists?.topRiskEvents ?? []
  const breakdowns = dashboard?.breakdowns
  const statusRows = dashboard?.statusDistribution?.rows ?? []
  const deltas = dashboard?.comparison?.deltas ?? null
  const granularityLabel = GRANULARITY_OPTIONS.find((g) => g.value === granularity)?.label ?? 'Semana'
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return users
      .filter((user) => {
        if (roleFilter && !selectedUserId && user.orgRole?.code !== roleFilter) return false
        if (!q) return true
        return userDisplayLabel(user).toLowerCase().includes(q) || (user.email || '').toLowerCase().includes(q)
      })
      .slice(0, 30)
  }, [users, userSearch, roleFilter, selectedUserId])

  function selectAnalyticsUser(user: AnalyticsUserOption | TopRiskPerson) {
    const label = 'displayName' in user ? user.displayName : userDisplayLabel(user)
    setSelectedUserId('userId' in user ? user.userId : user.id)
    setSelectedUserName(label)
    setUserSearch(label)
    setRoleFilter('')
    setIsUserDropdownOpen(false)
    setExportNotice('')
  }

  return (
    <RoleGuard permission="analytics.read" permissionScope="all">
      <main className="responsive-page max-w-7xl space-y-8">
        <header className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <BarChart3 className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h1 className="text-3xl font-bold text-gray-900">Analítica institucional</h1>
                {loading && dashboard ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-0.5 text-xs font-medium text-emerald-800">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Actualizando datos…
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-3xl leading-relaxed text-gray-600">
                Tablero operativo sobre obligaciones efectivamente planificadas y su conciliación con fichadas para priorizar políticas horarias,
                seguimiento a personas responsables y ajustes sobre eventos con impacto institucional.
              </p>
              {dashboard ? (
                <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-100 pt-4 text-sm text-gray-700">
                  <div>
                    <span className="text-gray-500">Universo analizado</span>
                    <span className="ml-2 font-semibold tabular-nums text-emerald-700">
                      {resolvedCount.toLocaleString('es-UY')} obligaciones
                    </span>
                  </div>
                  <span className="hidden text-gray-300 sm:inline" aria-hidden>
                    ·
                  </span>
                  <div>
                    <span className="text-gray-500">Ámbito de rol</span>
                    <span className="ml-2 font-semibold">{selectedUserName ? 'Persona seleccionada' : roleChipLabel(roleFilter)}</span>
                  </div>
                  {selectedUserName ? (
                    <>
                      <span className="hidden text-gray-300 sm:inline" aria-hidden>
                        ·
                      </span>
                      <div>
                        <span className="text-gray-500">Persona</span>
                        <span className="ml-2 font-semibold text-emerald-800">{selectedUserName}</span>
                      </div>
                    </>
                  ) : null}
                  {eventType ? (
                    <>
                      <span className="hidden text-gray-300 sm:inline" aria-hidden>
                        ·
                      </span>
                      <div>
                        <span className="text-gray-500">Actividad</span>
                        <span className="ml-2 font-semibold">{getAdminEventTypeLabel(eventType)}</span>
                      </div>
                    </>
                  ) : null}
                  {generatedLabel ? (
                    <>
                      <span className="hidden text-gray-300 sm:inline" aria-hidden>
                        ·
                      </span>
                      <div title="Último cálculo en backend">
                        <span className="text-gray-500">Generado</span>
                        <span className="ml-2 tabular-nums text-gray-800">{generatedLabel}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
            <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-50"
                disabled={loading && !dashboard}
                onClick={() => void loadDashboard()}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                Refrescar
              </button>
              <button
                type="button"
                disabled={loading || exportingKind === 'xlsx'}
                className="btn-success inline-flex items-center gap-2 text-sm disabled:opacity-50"
                onClick={() => void runExportAttendance('XLSX')}
              >
                {exportingKind === 'xlsx' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
                )}
                {selectedUserName ? 'Excel detalle' : 'Excel'}
              </button>
              <button
                type="button"
                disabled={loading || exportingKind === 'csv'}
                className="btn-success inline-flex items-center gap-2 text-sm disabled:opacity-50"
                onClick={() => void runExportAttendance('CSV')}
              >
                {exportingKind === 'csv' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-white" aria-hidden />
                )}
                {selectedUserName ? 'CSV detalle' : 'CSV'}
              </button>
              <button
                type="button"
                disabled={loading || exportingKind === 'pdf'}
                className="btn-danger inline-flex items-center gap-2 text-sm disabled:opacity-50"
                onClick={() => void runExportMonthly()}
              >
                {exportingKind === 'pdf' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                )}
                PDF resumen
              </button>
              <button
                type="button"
                disabled={loading || exportingKind === 'person'}
                className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-50"
                onClick={() => void runExportPerson()}
              >
                {exportingKind === 'person' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Users className="h-4 w-4 shrink-0" aria-hidden />
                )}
                Por persona
              </button>
              <button
                type="button"
                disabled={loading || exportingKind === 'course'}
                className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-50"
                onClick={() => void runExportCourse()}
              >
                {exportingKind === 'course' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <GraduationCap className="h-4 w-4 shrink-0" aria-hidden />
                )}
                Por curso
              </button>
            </div>
            <p className="max-w-sm text-right text-xs text-gray-500">
              {selectedUserName
                ? `Excel/CSV descargan el detalle filtrado de ${selectedUserName}; “Por persona” descarga su resumen.`
                : 'Las exportaciones reutilizan el motor institucional de reportes sobre el mismo rango vigente.'}
            </p>
          </div>
        </header>

        <div className="card">
          <div className="card-header">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                  <Search className="h-4 w-4 text-emerald-600" aria-hidden />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Filtros de búsqueda</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Todos los KPIs, rankings y gráficas respetan estos criterios en conjunto.</p>
                </div>
              </div>
              <button type="button" onClick={() => clearFiltersAndReload()} className="btn-secondary inline-flex items-center gap-2 text-sm">
                <Trash2 className="h-4 w-4" aria-hidden />
                Limpiar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-1">
              <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Desde (período)
              </label>
              <DateField value={from} onChange={setFrom} className="input-field" />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Hasta (período)
              </label>
              <DateField value={to} onChange={setTo} className="input-field" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Rol asignado al evento</label>
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value)
                  setSelectedUserId('')
                  setSelectedUserName('')
                  setUserSearch('')
                  setExportNotice('')
                }}
                className="select-field"
              >
                <option value="">Todos los roles</option>
                <option value="TEACHER">Docentes</option>
                <option value="STAFF">Personal</option>
                <option value="ADMIN">Administradores</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Equivalente operativo del filtro utilizado también en otros módulos de control de personal.
              </p>
            </div>
            <div className="relative">
              <label className="mb-2 block text-sm font-medium text-gray-700">Persona</label>
              <input
                type="text"
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value)
                  setSelectedUserId('')
                  setSelectedUserName('')
                  setIsUserDropdownOpen(true)
                  setExportNotice('')
                }}
                onFocus={() => setIsUserDropdownOpen(true)}
                placeholder="Buscar persona..."
                className="input-field"
              />
              {isUserDropdownOpen && !selectedUserId ? (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {filteredUsers.length > 0 ? (
                    filteredUsers.map((user) => (
                      <button
                        type="button"
                        key={user.id}
                        onClick={() => selectAnalyticsUser(user)}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-emerald-50"
                      >
                        <span className="block font-medium text-gray-900">{userDisplayLabel(user)}</span>
                        <span className="block truncate text-xs text-gray-500">
                          {[user.email, roleChipLabel(user.orgRole?.code || '')].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-gray-500">Sin coincidencias</div>
                  )}
                </div>
              ) : null}
              {selectedUserName ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm">
                  <span className="truncate font-medium text-emerald-900">{selectedUserName}</span>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold text-red-700 hover:text-red-900"
                    onClick={() => {
                      setSelectedUserId('')
                      setSelectedUserName('')
                      setUserSearch('')
                      setIsUserDropdownOpen(false)
                      setExportNotice('')
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-gray-500">Filtra indicadores y exportaciones al historial de una persona.</p>
              )}
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Tipo de actividad</label>
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="select-field">
                <option value="">Todos</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {getAdminEventTypeLabel(t)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Aisla un tipo de encuentro institucional (clase, jornada, reunión…).</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
            <span className="text-sm font-medium text-gray-700">Granularidad de las tendencias</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-200" role="group" aria-label="Granularidad temporal">
              {GRANULARITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGranularity((current) => (current === opt.value ? null : opt.value))}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    granularity === opt.value ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                  aria-pressed={granularity === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">Define cómo se agrupan las series de tendencia (día, semana o mes).</p>
          </div>
        </div>

        {exportNotice ? (
          <div
            className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm ${exportNotice.includes('✅') ? 'border-green-200' : 'border-red-200'} ${getAdminFlashMessageClass(exportNotice)}`}
            role="status"
          >
            {exportNotice}
            <button
              type="button"
              className="ml-3 text-xs font-semibold underline"
              onClick={() => setExportNotice('')}
            >
              Ocultar
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{error}</span>
            <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => void loadDashboard()}>
              Reintentar
            </button>
          </div>
        ) : null}

        {!dashboard && loading ? (
          <div className="space-y-6">
            <p className="text-sm font-medium text-gray-600">Cargando modelo analítico…</p>
            <AnalyticsSkeletonGrid />
          </div>
        ) : null}

        {dashboard ? (
          <>
            <section className="card border-emerald-100/90 bg-emerald-50/35" aria-labelledby="interpretacion-heading">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                  <Lightbulb className="h-5 w-5 text-emerald-800" aria-hidden />
                </div>
                <div>
                  <h2 id="interpretacion-heading" className="text-lg font-semibold text-gray-900">
                    Lectura ejecutiva orientada a la decisión
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm text-gray-600">
                    Esta capa sintetiza el mismo modelo numérico de la tabla siguiente: combina valores críticos, volumen muestral y listas de trabajo.
                  </p>
                </div>
              </div>
              <ol className="ml-8 list-decimal space-y-2 border-t border-emerald-100/80 pt-4 text-sm text-gray-800">
                {decisionSignals.map((line, idx) => (
                  <li key={`sig-${idx}`} className="pl-2 leading-snug marker:font-semibold">
                    {line}
                  </li>
                ))}
              </ol>
              <footer className="mt-6 border-t border-emerald-100 pt-4 text-xs text-gray-600">
                <strong>Gobernanza de datos:</strong> los rankings están pensados como listas exploratorias ante el directorio institucional. No otorgan estado
                ni sanciones automáticas; validá siempre con contexto cualitativo antes de comunicar métricas a terceros.
              </footer>
            </section>

            <section aria-labelledby="kpi-heading" className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 id="kpi-heading" className="text-lg font-semibold text-gray-900">
                  Indicadores agregados
                </h2>
                <p className="max-w-xl text-xs text-gray-500">Definiciones alineadas con el motor de métricas de conciliación de instancias (asistente de exportaciones usa el mismo modelo).</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
                <KpiCard
                  label="Puntualidad en entrada"
                  hint="Porcentaje de llegadas marcadas puntual sobre entradas con registro válido."
                  tone="emerald"
                  value={formatPct(dashboard.kpis.M1_PUNCTUALITY_pct)}
                  foot="Sobre llegadas efectivamente registradas"
                  delta={deltas?.M1_PUNCTUALITY_pct}
                  deltaHigherIsBetter
                />
                <KpiCard
                  label="Llegadas tarde"
                  hint="Porcentaje de entradas con estado tardío dentro del período seleccionado."
                  tone="amber"
                  value={formatPct(dashboard.kpis.M2_LATE_RATE_pct)}
                  foot="Indicador de disciplina horaria inicial"
                  delta={deltas?.M2_LATE_RATE_pct}
                  deltaHigherIsBetter={false}
                />
                <KpiCard
                  label="Ausencias no cubiertas / plan"
                  hint="Ausencias efectivas contra instancias programadas incluidas en el período."
                  tone="red"
                  value={formatPct(dashboard.kpis.M4_AOP_pct)}
                  foot="Ausentismo efectivo institucional"
                  delta={deltas?.M4_AOP_pct}
                  deltaHigherIsBetter={false}
                />
                <KpiCard
                  label="Cobertura de presencia efectiva"
                  hint="Combinación entrada/salida que cubra la sesión institucional modelada."
                  tone="emerald"
                  value={formatPct(dashboard.kpis.M6_COVERAGE_CP_pct)}
                  foot="Señal integral de ocupación efectiva del bloque planificado"
                  delta={deltas?.M6_COVERAGE_CP_pct}
                  deltaHigherIsBetter
                />
                <KpiCard
                  label="Desvío temporal vs planificado"
                  hint="Relación tiempos observados contra ventana institucional reservada (horas efectivas)."
                  tone="slate"
                  value={formatPct(dashboard.kpis.M8_HOURS_DELTA_pct)}
                  foot="Interpretación relativa sin escala absoluta institucional fija"
                />
                <KpiCard label="Licencias inactivas" tone="slate" value={dashboard.kpis.PC_count} foot="Rango solapante con período solicitado." />
              </div>
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section className="card" aria-labelledby="rank-people-heading">
                <header className="mb-5 flex flex-col gap-1 border-b border-gray-100 pb-4">
                  <h2 id="rank-people-heading" className="text-lg font-semibold text-gray-900">
                    Personas prioritarias para revisión institucional
                  </h2>
                  <p className="text-sm text-gray-600">
                    Puntajes calculados sólo dentro del período filtrado. Las ausencias con licencia activa válida pierden penalización en puntaje.
                  </p>
                  <Link
                    href="/admin/attendance"
                    prefetch={false}
                    className="mt-3 inline-flex w-fit items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-900"
                  >
                    Abrir cuadro de control de personal
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                  </Link>
                </header>

                {peopleRank.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">No registramos instancias con usuario asignado en los filtros actuales.</p>
                ) : (
                  <>
                  <div className="hidden overflow-hidden rounded-xl border border-gray-100 sm:block">
                    <div className="max-h-[22rem] overflow-auto">
                      <table className="min-w-[640px] text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
                          <tr>
                            <th scope="col" className="px-4 py-3">
                              Persona
                            </th>
                            <th scope="col" className="hidden px-2 py-3 sm:table-cell">
                              Rol
                            </th>
                            <th scope="col" className="hidden px-2 py-3 text-right lg:table-cell" title="Instancias contabilizadas en el período">
                              Oblig.
                            </th>
                            <th scope="col" className="px-2 py-3 text-right">
                              Tarde
                            </th>
                            <th scope="col" className="hidden px-2 py-3 text-right md:table-cell" title="Ausencia sin cobertura de licencia válida para la fecha">
                              Aus NJ
                            </th>
                            <th scope="col" className="hidden px-2 py-3 text-right xl:table-cell" title="Licencia activa alcanzó esa ausencia como justificación">
                              Aus OK
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-800" title="Heurística: tarde ×1 + aus NJ ×2">
                              Prioridad Σ
                            </th>
                            <th scope="col" className="px-4 py-3 text-right">
                              Reporte
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {peopleRank.map((p, i) => (
                            <tr key={p.userId} className={`transition-colors hover:bg-emerald-50/40 ${i === 0 && p.riskScore > 0 ? 'bg-amber-50/30' : ''}`}>
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-900">{p.displayName}</div>
                                <div className="text-xs font-mono text-gray-400">{p.userId.slice(0, 8)}…</div>
                              </td>
                              <td className="hidden px-2 py-3 text-xs text-gray-600 sm:table-cell">{roleChipLabel(p.role)}</td>
                              <td className="hidden px-2 py-3 text-right tabular-nums lg:table-cell">{p.plannedCount}</td>
                              <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums text-amber-800">{p.lateCount}</td>
                              <td className="hidden px-2 py-3 text-right tabular-nums font-medium text-red-700 md:table-cell">{p.absentNotJustifiedCount}</td>
                              <td className="hidden px-2 py-3 text-right tabular-nums text-gray-500 xl:table-cell">{p.absentJustifiedCount}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-right">
                                <span
                                  className={`inline-flex min-w-[2.5rem] justify-end rounded-full px-2 py-1 text-xs font-bold tabular-nums ${getRiskScoreBadgeClass(p.riskScore)}`}
                                >
                                  {p.riskScore}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right">
                                <button
                                  type="button"
                                  className="rounded-md border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                                  onClick={() => selectAnalyticsUser(p)}
                                >
                                  Ver detalle
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="space-y-3 sm:hidden">
                    {peopleRank.map((p) => (
                      <PersonRankCard key={p.userId} p={p} onSelect={() => selectAnalyticsUser(p)} />
                    ))}
                  </div>
                  </>
                )}
              </section>

              <section className="card" aria-labelledby="rank-events-heading">
                <header className="mb-5 flex flex-col gap-1 border-b border-gray-100 pb-4">
                  <h2 id="rank-events-heading" className="text-lg font-semibold text-gray-900">
                    Tipos / eventos con mayor fricción operativa
                  </h2>
                  <p className="text-sm text-gray-600">
                    Ranking por suma combinada tardanza + absentismo efectivo dentro del período seleccionado. Id útil cuando el volumen permite comparar agendas.
                  </p>
                  <Link
                    href="/admin/events"
                    prefetch={false}
                    className="mt-3 inline-flex w-fit items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-900"
                  >
                    Gestionar cronogramas de eventos
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                  </Link>
                </header>

                {eventsRank.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">Sin eventos suficientemente representados dentro del período.</p>
                ) : (
                  <>
                  <div className="hidden overflow-hidden rounded-xl border border-gray-100 sm:block">
                    <div className="max-h-[22rem] overflow-auto">
                      <table className="min-w-[640px] text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
                          <tr>
                            <th scope="col" className="min-w-[8rem] px-4 py-3">
                              Actividad
                            </th>
                            <th scope="col" className="px-2 py-3">
                              Tipo
                            </th>
                            <th scope="col" className="hidden px-2 py-3 text-right sm:table-cell">
                              Oblig.
                            </th>
                            <th scope="col" className="px-2 py-3 text-right">
                              % Tarde
                            </th>
                            <th scope="col" className="px-2 py-3 text-right">
                              % Aus
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900" title="Suma combinada tardanza % + ausentismo %">
                              Índice
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {eventsRank.map((e, i) => (
                            <tr key={e.eventId} className={`transition-colors hover:bg-slate-50/80 ${i === 0 && e.focusScore > 0 ? 'bg-red-50/25' : ''}`}>
                              <td className="px-4 py-3">
                                <div className="line-clamp-2 font-semibold text-gray-900" title={`${e.title} · ${e.eventId}`}>
                                  {e.title}
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-2 py-3">
                                <span className="inline-flex rounded-md border border-emerald-100 bg-emerald-50/70 px-2 py-1 text-[11px] font-medium uppercase text-emerald-900">
                                  {getAdminEventTypeLabel(e.eventType)}
                                </span>
                              </td>
                              <td className="hidden px-2 py-3 text-right tabular-nums text-gray-600 sm:table-cell">{e.plannedCount}</td>
                              <td className="px-2 py-3 text-right tabular-nums text-amber-800">{formatPct(e.lateRatePct)}</td>
                              <td className="px-2 py-3 text-right tabular-nums font-medium text-red-700">{formatPct(e.absentOverPlanPct)}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{e.focusScore.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="space-y-3 sm:hidden">
                    {eventsRank.map((e) => (
                      <EventRankCard key={e.eventId} e={e} />
                    ))}
                  </div>
                  </>
                )}
              </section>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <section className="card lg:col-span-1" aria-labelledby="status-dist-heading">
                <header className="mb-4 flex items-start gap-3 border-b border-gray-100 pb-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <PieChartIcon className="h-5 w-5 text-emerald-700" aria-hidden />
                  </div>
                  <div>
                    <h2 id="status-dist-heading" className="text-lg font-semibold text-gray-900">
                      Distribución de estados
                    </h2>
                    <p className="mt-0.5 text-sm text-gray-600">Resolución de entradas sobre lo planificado.</p>
                  </div>
                </header>
                <StatusDonutChart rows={statusRows} />
              </section>

              <section className="card lg:col-span-2" aria-labelledby="trend-heading">
                <header className="mb-4 flex items-start gap-3 border-b border-gray-100 pb-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <BarChart3 className="h-5 w-5 text-emerald-700" aria-hidden />
                  </div>
                  <div>
                    <h2 id="trend-heading" className="text-lg font-semibold text-gray-900">
                      Tendencias por {granularityLabel.toLowerCase()}
                    </h2>
                    <p className="mt-0.5 text-sm text-gray-600">
                      Tardanza, ausentismo y cobertura efectiva agrupadas según la granularidad elegida.
                    </p>
                  </div>
                </header>
                <TrendLineChart points={trendPoints} />
              </section>
            </div>

            {breakdowns ? (
              <section className="card" aria-labelledby="breakdowns-heading">
                <header className="mb-5 flex items-start gap-3 border-b border-gray-100 pb-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                    <LayoutGrid className="h-5 w-5 text-emerald-700" aria-hidden />
                  </div>
                  <div>
                    <h2 id="breakdowns-heading" className="text-lg font-semibold text-gray-900">
                      Desgloses por dimensión
                    </h2>
                    <p className="mt-0.5 text-sm text-gray-600">
                      Tardanza vs ausentismo comparados por rol, tipo de actividad y curso dentro del período.
                    </p>
                  </div>
                </header>
                <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
                  <div>
                    <h3 className="mb-3 text-base font-semibold text-gray-800">Por rol</h3>
                    <BreakdownBarChart rows={breakdowns.byRole} />
                  </div>
                  <div>
                    <h3 className="mb-3 text-base font-semibold text-gray-800">Por tipo de actividad</h3>
                    <BreakdownBarChart rows={breakdowns.byEventType} />
                  </div>
                  <div>
                    <h3 className="mb-3 text-base font-semibold text-gray-800">Por curso</h3>
                    <BreakdownBarChart rows={breakdowns.byCourse} />
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </RoleGuard>
  )
}
