'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import DateRangePicker from '@/components/forms/DateRangePicker'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import { ymdToDmy } from '@/lib/forms/date-mask'
import { getTodayYmdInUruguay } from '@/lib/forms/datetime-uy'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { getAdminEventTypeLabel } from '@/lib/admin/events-display'
import {
  getRiskScoreBadgeClass,
  resolveSchoolYearDateRange,
  staffIndicatorParams,
  staffReportPath,
  type StaffIndicatorFilters,
} from '@/lib/admin/analytics-display'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  SlidersHorizontal,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import TrendLineChart from '@/components/charts/TrendLineChart'
import BreakdownBarChart from '@/components/charts/BreakdownBarChart'
import StatusDonutChart from '@/components/charts/StatusDonutChart'
import ModuleHeader from '@/components/common/ModuleHeader'
import ReportDownloadMenu from '@/components/common/ReportDownloadMenu'

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

type SeriesMultiPoint = {
  period: string
  lateRate: number
  aop: number
  coverage: number
}

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
  /** "Lectura del período": la arma el servidor, la misma que imprime el informe. */
  signals?: string[]
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

type KpiTone = 'emerald' | 'amber' | 'red' | 'slate'

/** Delta vs período anterior. `higherIsBetter` define el color (verde/rojo). */
function DeltaBadge({
  delta,
  higherIsBetter,
  suffix = ' p.p.',
}: {
  delta: number
  higherIsBetter: boolean
  suffix?: string
}) {
  if (Math.abs(delta) < 0.01) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
        Sin cambios
      </span>
    )
  }
  const isUp = delta > 0
  const good = isUp === higherIsBetter
  const cls = good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
  const Icon = isUp ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${cls}`}
      title="Variación vs período anterior"
    >
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
  const {
    label,
    hint,
    value,
    foot,
    tone,
    delta,
    deltaHigherIsBetter,
    deltaSuffix,
  } = props

  return (
    <article className="flex flex-col justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div>
        <h3 title={hint} className="text-sm font-medium text-gray-600">
          {label}
          {hint ? (
            <span className="ml-1 cursor-help text-gray-400">ⓘ</span>
          ) : null}
        </h3>
        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <p
            className={`text-2xl font-bold tabular-nums tracking-tight ${toneMap[tone]}`}
          >
            {value}
          </p>
          {typeof delta === 'number' ? (
            <DeltaBadge
              delta={delta}
              higherIsBetter={deltaHigherIsBetter ?? true}
              suffix={deltaSuffix ?? ' p.p.'}
            />
          ) : null}
        </div>
      </div>
      {foot ? <p className="mt-3 text-xs text-gray-500">{foot}</p> : null}
    </article>
  )
}

function AnalyticsSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={`sk-${String(i)}`}
          className="h-28 animate-pulse rounded-xl border border-gray-100 bg-gradient-to-br from-gray-50 to-gray-100"
        />
      ))}
    </div>
  )
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

function PersonRankCard({
  p,
  onSelect,
}: Readonly<{ p: TopRiskPerson; onSelect: () => void }>) {
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-slate-900">
            {p.displayName}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{roleChipLabel(p.role)}</p>
        </div>
        <span
          aria-label={`Prioridad: ${p.riskScore}`}
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${getRiskScoreBadgeClass(p.riskScore)}`}
        >
          {p.riskScore}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        {p.lateCount} llegadas tarde · {p.absentNotJustifiedCount} ausencias sin
        justificar
      </p>
      <SettingsDetails title={`Ver cifras de ${p.displayName}`}>
        <dl className="space-y-2 text-sm text-slate-600">
          <div className="flex justify-between gap-3">
            <dt>Registros planificados</dt>
            <dd>{p.plannedCount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Llegadas tarde</dt>
            <dd>{p.lateCount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Ausencias sin justificar</dt>
            <dd>{p.absentNotJustifiedCount}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Ausencias justificadas</dt>
            <dd>{p.absentJustifiedCount}</dd>
          </div>
        </dl>
      </SettingsDetails>
      <button
        type="button"
        aria-label={`Ver indicadores de ${p.displayName}`}
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
      >
        Ver indicadores
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </button>
    </article>
  )
}

function EventRankCard({ e }: Readonly<{ e: TopRiskEvent }>) {
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">
          {e.title}
        </h3>
        <span
          className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"
          aria-label={`Índice: ${e.focusScore.toFixed(2)}`}
        >
          {e.focusScore.toFixed(2)}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        {getAdminEventTypeLabel(e.eventType)}
      </p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <p className="text-slate-600">
          Tardanzas{' '}
          <strong className="block font-semibold text-amber-700">
            {formatPct(e.lateRatePct)}
          </strong>
        </p>
        <p className="text-slate-600">
          Ausencias{' '}
          <strong className="block font-semibold text-red-700">
            {formatPct(e.absentOverPlanPct)}
          </strong>
        </p>
      </div>
      <p className="text-xs text-slate-500">
        {e.plannedCount} registros planificados
      </p>
    </article>
  )
}

export default function AdminAnalyticsPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const [view, setView] = useState<'summary' | 'trends' | 'followup'>('summary')
  const [showFilters, setShowFilters] = useState(false)
  const [breakdown, setBreakdown] = useState<
    'byRole' | 'byEventType' | 'byCourse'
  >('byRole')
  const requestId = useRef(0)
  const userPicker = useRef<HTMLDivElement>(null)
  const userListId = useId()
  const [activeUserIndex, setActiveUserIndex] = useState(0)
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 29)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  /** Vacío = sin filtro (todos los usuarios planificados en el período). */
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [eventType, setEventType] = useState<string>('')
  const [granularity, setGranularity] = useState<SeriesGranularity>('week')
  const [users, setUsers] = useState<AnalyticsUserOption[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [selectedUserName, setSelectedUserName] = useState('')
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const canDownloadReport = hasPermission(
    useOptionalAuth()?.me,
    'exports.create',
    'all',
  )

  const analyticsSchoolYearId = syCtx?.selectedId ?? syCtx?.activeId ?? null

  // Fila del ciclo lectivo efectivamente filtrado (para derivar su rango de fechas).
  const selectedYearRow = useMemo(
    () =>
      analyticsSchoolYearId
        ? (syCtx?.years.find((y) => y.id === analyticsSchoolYearId) ?? null)
        : null,
    [syCtx?.years, analyticsSchoolYearId],
  )

  // Rango de fechas que corresponde al ciclo lectivo en foco: el dashboard debe mirar
  // el período del ciclo seleccionado, no los últimos 30 días (que suelen quedar fuera
  // de un ciclo cerrado y dejan todos los KPIs en 0). Se acota a "hoy" para ciclos en curso.
  const yearRange = useMemo<{ from: string; to: string } | null>(() => {
    const today = getTodayYmdInUruguay()
    if (syCtx?.allYears) {
      const starts = (syCtx.years ?? [])
        .map((y) => y.startsOn?.slice(0, 10))
        .filter((v): v is string => Boolean(v))
        .sort((a, b) => a.localeCompare(b))
      if (starts.length === 0) return null
      return { from: starts[0] > today ? today : starts[0], to: today }
    }
    return resolveSchoolYearDateRange(selectedYearRow, today)
  }, [syCtx?.allYears, syCtx?.years, selectedYearRow])

  // Identidad de la selección de ciclo: cambiar de ciclo (o a "todos") re-sincroniza el rango,
  // pero ediciones manuales de fecha posteriores se respetan (no se vuelven a sobreescribir).
  const selectionKey = syCtx?.allYears ? 'ALL' : analyticsSchoolYearId
  const appliedSelectionRef = useRef<string | null>(null)
  const selectionChanged = Boolean(
    yearRange && selectionKey && appliedSelectionRef.current !== selectionKey,
  )
  const requestedFrom = selectionChanged ? (yearRange?.from ?? from) : from
  const requestedTo = selectionChanged ? (yearRange?.to ?? to) : to
  const schoolYearsLoading = syCtx?.loading ?? false
  const allYears = syCtx?.allYears ?? false

  useEffect(() => {
    if (!yearRange || !selectionKey) return
    if (appliedSelectionRef.current === selectionKey) return
    appliedSelectionRef.current = selectionKey
    setFrom(yearRange.from)
    setTo(yearRange.to)
  }, [selectionKey, yearRange])

  const rangeError =
    !requestedFrom || !requestedTo
      ? 'Elegí el inicio y el fin del período.'
      : requestedFrom > requestedTo
        ? 'La fecha de fin debe ser igual o posterior al inicio.'
        : null
  const indicatorFilters = useMemo<StaffIndicatorFilters>(
    () => ({
      from: requestedFrom,
      to: requestedTo,
      granularity,
      userId: selectedUserId || undefined,
      role: roleFilter || undefined,
      eventType: eventType || undefined,
      allYears,
      schoolYearId: analyticsSchoolYearId,
    }),
    [
      requestedFrom,
      requestedTo,
      granularity,
      selectedUserId,
      roleFilter,
      eventType,
      allYears,
      analyticsSchoolYearId,
    ],
  )
  const loadDashboard = useCallback(async () => {
    const currentRequest = ++requestId.current
    if (rangeError || schoolYearsLoading) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = staffIndicatorParams(indicatorFilters)
      const data = await api<DashboardResponse>(
        `/analytics/dashboard?${params.toString()}`,
      )
      if (currentRequest === requestId.current) setDashboard(data)
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : 'No se pudo cargar el dashboard'
      if (currentRequest === requestId.current)
        setError(msg || 'No se pudo cargar el dashboard')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }, [indicatorFilters, schoolYearsLoading, rangeError])

  const cancelPendingLoad = useCallback(() => {
    requestId.current++
  }, [])
  useEffect(() => {
    void loadDashboard()
    return cancelPendingLoad
  }, [loadDashboard, cancelPendingLoad])

  useEffect(() => {
    let active = true
    async function loadUsers() {
      try {
        const data = await api<{ data: AnalyticsUserOption[] }>(
          '/admin/users?pageSize=200',
        )
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
    setGranularity('week')
    setSelectedUserId('')
    setUserSearch('')
    setSelectedUserName('')
    setIsUserDropdownOpen(false)
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
  const granularityLabel =
    GRANULARITY_OPTIONS.find((g) => g.value === granularity)?.label ?? 'Semana'
  const filteredUsers = useMemo(() => {
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
    const q = normalize(userSearch)
    return users
      .filter((user) => {
        if (roleFilter && !selectedUserId && user.orgRole?.code !== roleFilter)
          return false
        if (!q) return true
        return (
          normalize(userDisplayLabel(user)).includes(q) ||
          normalize(user.email || '').includes(q)
        )
      })
      .slice(0, 30)
  }, [users, userSearch, roleFilter, selectedUserId])

  function selectAnalyticsUser(user: AnalyticsUserOption | TopRiskPerson) {
    const label =
      'displayName' in user ? user.displayName : userDisplayLabel(user)
    setView('summary')
    setSelectedUserId('userId' in user ? user.userId : user.id)
    setSelectedUserName(label)
    setUserSearch(label)
    setRoleFilter('')
    setIsUserDropdownOpen(false)
  }

  useEffect(() => {
    if (!isUserDropdownOpen) return
    function outside(event: PointerEvent) {
      if (!userPicker.current?.contains(event.target as Node))
        setIsUserDropdownOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [isUserDropdownOpen])

  useEffect(() => {
    if (isUserDropdownOpen)
      document
        .getElementById(`${userListId}-${activeUserIndex}`)
        ?.scrollIntoView?.({ block: 'nearest' })
  }, [isUserDropdownOpen, activeUserIndex, userListId])

  function clearPerson() {
    setSelectedUserId('')
    setSelectedUserName('')
    setUserSearch('')
    setIsUserDropdownOpen(false)
  }
  const advancedCount = Number(Boolean(roleFilter)) + Number(Boolean(eventType))
  const thirtyDaysAgo = new Date(`${getTodayYmdInUruguay()}T12:00:00Z`)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29)
  const periodPresets = [
    ...(yearRange
      ? [
          {
            label: syCtx?.allYears ? 'Todos los ciclos' : 'Todo el ciclo',
            startDate: yearRange.from,
            endDate: yearRange.to,
          },
        ]
      : []),
    {
      label: 'Últimos 30 días',
      startDate: thirtyDaysAgo.toISOString().slice(0, 10),
      endDate: getTodayYmdInUruguay(),
    },
    {
      label: 'Este mes',
      startDate: `${getTodayYmdInUruguay().slice(0, 7)}-01`,
      endDate: getTodayYmdInUruguay(),
    },
  ]
  const safeUserIndex = Math.min(
    activeUserIndex,
    Math.max(0, filteredUsers.length - 1),
  )
  const cardClass =
    'space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5'

  return (
    <RoleGuard permission="analytics.read" permissionScope="all">
      <main className="responsive-page max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <ModuleHeader id="staff-indicators" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading || Boolean(rangeError) || syCtx?.loading}
              onClick={() => void loadDashboard()}
              className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden
              />
              Actualizar
            </button>
            {canDownloadReport && (
              <ReportDownloadMenu
                tour="staff-indicators.report"
                disabled={
                  loading || Boolean(rangeError) || Boolean(syCtx?.loading)
                }
                note="Resumen, tendencias, seguimiento y todas las personas, con el período y los filtros elegidos."
                pathFor={(format) => staffReportPath(indicatorFilters, format)}
                fallbackName={(format) =>
                  `Indicadores del personal ${requestedFrom} a ${requestedTo}.${format}`
                }
              />
            )}
          </div>
        </div>
        <section aria-label="Filtros de indicadores" data-tour="staff-indicators.filters" className={cardClass}>
          <div className="grid gap-3 md:grid-cols-2">
            <DateRangePicker
              startDate={requestedFrom}
              endDate={requestedTo}
              presets={periodPresets}
              onChange={({ startDate, endDate }) => {
                if (!startDate && !endDate) {
                  setFrom(
                    yearRange?.from ?? thirtyDaysAgo.toISOString().slice(0, 10),
                  )
                  setTo(yearRange?.to ?? getTodayYmdInUruguay())
                } else {
                  setFrom(startDate)
                  setTo(endDate)
                }
              }}
            />
            <div
              ref={userPicker}
              role="presentation"
              className="relative min-w-0"
              onBlur={(event) => {
                if (
                  event.relatedTarget &&
                  !event.currentTarget.contains(event.relatedTarget as Node)
                )
                  setIsUserDropdownOpen(false)
              }}
            >
              <label
                htmlFor="analytics-person"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Persona
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                  aria-hidden
                />
                <input
                  id="analytics-person"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={isUserDropdownOpen && !selectedUserId}
                  aria-controls={
                    isUserDropdownOpen && !selectedUserId
                      ? userListId
                      : undefined
                  }
                  aria-activedescendant={
                    isUserDropdownOpen &&
                    !selectedUserId &&
                    filteredUsers.length
                      ? `${userListId}-${safeUserIndex}`
                      : undefined
                  }
                  value={userSearch}
                  placeholder="Todas las personas"
                  autoComplete="off"
                  className="input-field min-h-11 !pl-9 !pr-10 text-sm"
                  onFocus={() => {
                    if (!selectedUserId) {
                      setIsUserDropdownOpen(true)
                      setActiveUserIndex(0)
                    }
                  }}
                  onChange={(e) => {
                    setUserSearch(e.target.value)
                    setSelectedUserId('')
                    setSelectedUserName('')
                    setActiveUserIndex(0)
                    setIsUserDropdownOpen(true)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setIsUserDropdownOpen(false)
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      setIsUserDropdownOpen(true)
                      setActiveUserIndex((previous) =>
                        Math.max(
                          0,
                          Math.min(
                            filteredUsers.length - 1,
                            previous + (event.key === 'ArrowDown' ? 1 : -1),
                          ),
                        ),
                      )
                    }
                    if (
                      event.key === 'Enter' &&
                      isUserDropdownOpen &&
                      !selectedUserId &&
                      filteredUsers[safeUserIndex]
                    ) {
                      event.preventDefault()
                      selectAnalyticsUser(filteredUsers[safeUserIndex])
                    }
                  }}
                />
                {userSearch && (
                  <button
                    type="button"
                    aria-label="Quitar persona"
                    onClick={clearPerson}
                    className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              {isUserDropdownOpen && !selectedUserId && (
                <div
                  id={userListId}
                  role="listbox"
                  aria-label="Personas"
                  className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                >
                  {filteredUsers.length ? (
                    filteredUsers.map((user, index) => (
                      <button
                        id={`${userListId}-${index}`}
                        role="option"
                        aria-selected={safeUserIndex === index}
                        tabIndex={-1}
                        type="button"
                        key={user.id}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => selectAnalyticsUser(user)}
                        className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${safeUserIndex === index ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                      >
                        <span className="block break-words font-medium text-slate-800">
                          {userDisplayLabel(user)}
                        </span>
                        <span className="block break-words text-xs text-slate-500">
                          {[user.email, roleChipLabel(user.orgRole?.code)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="p-3 text-sm text-slate-500">
                      Sin coincidencias
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-slate-500">
              {[
                selectedUserName || roleChipLabel(roleFilter),
                eventType
                  ? getAdminEventTypeLabel(eventType)
                  : 'Todas las actividades',
              ].join(' · ')}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={clearFiltersAndReload}
                className="text-sm font-medium text-emerald-700 hover:underline"
              >
                Limpiar filtros
              </button>
              <button
                type="button"
                aria-expanded={showFilters}
                aria-controls="analytics-extra-filters"
                onClick={() => {
                  setShowFilters(!showFilters)
                  setIsUserDropdownOpen(false)
                }}
                className="inline-flex items-center gap-2 text-sm text-slate-600"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                Más filtros{advancedCount ? ` (${advancedCount})` : ''}
                <ChevronDown
                  className={`h-4 w-4 transition ${showFilters ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
            </div>
          </div>
          {showFilters && (
            <div
              id="analytics-extra-filters"
              className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"
            >
              <div>
                <label
                  htmlFor="analytics-role"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Rol
                </label>
                <select
                  id="analytics-role"
                  value={roleFilter}
                  onChange={(e) => {
                    setRoleFilter(e.target.value)
                    clearPerson()
                  }}
                  className="select-field text-sm"
                >
                  <option value="">Todos los roles</option>
                  <option value="TEACHER">Docentes</option>
                  <option value="STAFF">Personal</option>
                  <option value="ADMIN">Administradores</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="analytics-activity"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Tipo de actividad
                </label>
                <select
                  id="analytics-activity"
                  value={eventType}
                  onChange={(e) => {
                    setEventType(e.target.value)
                  }}
                  className="select-field text-sm"
                >
                  <option value="">Todas las actividades</option>
                  {EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {getAdminEventTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>
        <div
          role="group"
          aria-label="Vistas de indicadores"
          data-tour="staff-indicators.views"
          className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1"
        >
          {(
            [
              ['summary', 'Resumen'],
              ['trends', 'Tendencias'],
              ['followup', 'Seguimiento'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              aria-controls="analytics-results"
              onClick={() => {
                setView(value)
                setIsUserDropdownOpen(false)
              }}
              className={`flex-1 rounded-lg px-2 py-2.5 text-sm font-medium ${view === value ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {(rangeError || error) && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <p>{rangeError || error}</p>
            {!rangeError && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadDashboard()}
                className="font-medium hover:underline disabled:opacity-50"
              >
                Reintentar
              </button>
            )}
          </div>
        )}
        <div id="analytics-results" className="space-y-4">
          {loading || syCtx?.loading ? (
            <div role="status" className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Actualizando indicadores…
              </p>
              <AnalyticsSkeletonGrid />
            </div>
          ) : (
            !rangeError &&
            !error &&
            dashboard && (
              <>
                <p className="text-sm text-slate-500">
                  {resolvedCount.toLocaleString('es-UY')} registros planificados
                  en el período{selectedUserName && ` · ${selectedUserName}`}
                </p>
                {resolvedCount === 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
                    <p className="text-sm text-slate-600">
                      No hay registros planificados para estos filtros.
                    </p>
                    <button
                      type="button"
                      onClick={clearFiltersAndReload}
                      className="mt-3 text-sm font-medium text-emerald-700 hover:underline"
                    >
                      Ver todo el período
                    </button>
                  </div>
                )}
                {resolvedCount > 0 && (
                  <>
                    {view === 'summary' && (
                      <>
                        <section
                          aria-label="Indicadores principales"
                          data-tour="staff-indicators.charts"
                          className="space-y-3"
                        >
                          {dashboard.comparison && (
                            <p className="text-xs text-slate-500">
                              Variación respecto al{' '}
                              {ymdToDmy(dashboard.comparison.previousFrom)}–
                              {ymdToDmy(dashboard.comparison.previousTo)}.
                              Diferencias en puntos porcentuales.
                            </p>
                          )}
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <KpiCard
                              label="Puntualidad"
                              tone="emerald"
                              value={formatPct(
                                dashboard.kpis.M1_PUNCTUALITY_pct,
                              )}
                              foot="Entradas puntuales sobre las registradas"
                              delta={deltas?.M1_PUNCTUALITY_pct}
                              deltaHigherIsBetter
                            />
                            <KpiCard
                              label="Llegadas tarde"
                              tone="amber"
                              value={formatPct(dashboard.kpis.M2_LATE_RATE_pct)}
                              foot="Entradas tarde sobre las registradas"
                              delta={deltas?.M2_LATE_RATE_pct}
                              deltaHigherIsBetter={false}
                            />
                            <KpiCard
                              label="Ausentismo"
                              tone="red"
                              value={formatPct(dashboard.kpis.M4_AOP_pct)}
                              foot="Ausencias sobre lo planificado, incluidas las justificadas"
                              delta={deltas?.M4_AOP_pct}
                              deltaHigherIsBetter={false}
                            />
                            <KpiCard
                              label="Cobertura de asistencia"
                              tone="emerald"
                              value={formatPct(
                                dashboard.kpis.M6_COVERAGE_CP_pct,
                              )}
                              foot="Presencias sobre lo planificado"
                              delta={deltas?.M6_COVERAGE_CP_pct}
                              deltaHigherIsBetter
                            />
                          </div>
                        </section>
                        <SettingsDetails
                          title="Más indicadores"
                          description="Horas registradas y licencias inactivas."
                        >
                          <div className="grid gap-3 sm:grid-cols-2">
                            <KpiCard
                              label="Desvío de horas"
                              tone="slate"
                              value={formatPct(
                                dashboard.kpis.M8_HOURS_DELTA_pct,
                              )}
                              foot="Diferencia de tiempo registrado respecto al planificado"
                            />
                            <KpiCard
                              label="Licencias inactivas"
                              tone="slate"
                              value={dashboard.kpis.PC_count}
                              foot="Licencias inactivas que coinciden con el período"
                            />
                          </div>
                        </SettingsDetails>
                        <SettingsDetails
                          title="Lectura del período"
                          description="Sugerencias para interpretar los resultados."
                        >
                          <ul className="list-disc space-y-2 pl-4 text-sm text-slate-600">
                            {(dashboard.signals ?? []).map((signal, index) => (
                              <li key={index}>{signal}</li>
                            ))}
                          </ul>
                        </SettingsDetails>
                      </>
                    )}
                    {view === 'trends' && (
                      <>
                        <section
                          className={cardClass}
                          aria-labelledby="analytics-trend-title"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h2
                                id="analytics-trend-title"
                                className="font-semibold text-slate-900"
                              >
                                Evolución de la asistencia
                              </h2>
                              <p className="mt-1 text-xs text-slate-500">
                                Tardanzas, ausencias y cobertura agrupadas por{' '}
                                {granularityLabel.toLowerCase()}.
                              </p>
                            </div>
                            <div
                              role="group"
                              aria-label="Agrupar tendencias por"
                              className="inline-flex gap-1 rounded-lg bg-slate-100 p-1"
                            >
                              {GRANULARITY_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  aria-pressed={granularity === option.value}
                                  onClick={() => setGranularity(option.value)}
                                  className={`rounded-md px-3 py-1.5 text-sm ${granularity === option.value ? 'bg-white font-medium text-emerald-700 shadow-sm' : 'text-slate-500'}`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <TrendLineChart points={trendPoints} />
                        </section>
                        <SettingsDetails
                          title="Distribución de asistencias"
                          description="Presentes, llegadas tarde y ausencias."
                        >
                          <StatusDonutChart rows={statusRows} />
                        </SettingsDetails>
                        {breakdowns && (
                          <section className={cardClass}>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <h2 className="font-semibold text-slate-900">
                                Comparar grupos
                              </h2>
                              <div>
                                <label
                                  htmlFor="analytics-breakdown"
                                  className="sr-only"
                                >
                                  Comparar por
                                </label>
                                <select
                                  id="analytics-breakdown"
                                  value={breakdown}
                                  onChange={(event) =>
                                    setBreakdown(
                                      event.target.value as typeof breakdown,
                                    )
                                  }
                                  className="select-field text-sm"
                                >
                                  <option value="byRole">Por rol</option>
                                  <option value="byEventType">
                                    Por tipo de actividad
                                  </option>
                                  <option value="byCourse">Por curso</option>
                                </select>
                              </div>
                            </div>
                            <BreakdownBarChart rows={breakdowns[breakdown]} />
                          </section>
                        )}
                      </>
                    )}
                    {view === 'followup' && (
                      <>
                        <p className="text-xs text-slate-500">
                          Estas listas ayudan a revisar casos. Los puntajes no
                          generan sanciones automáticas.
                        </p>
                        <div className="grid gap-4 xl:grid-cols-2">
                          <section
                            className={cardClass}
                            aria-labelledby="analytics-people-title"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h2
                                id="analytics-people-title"
                                className="font-semibold text-slate-900"
                              >
                                Personas para revisar
                              </h2>
                              <Link
                                href="/admin/attendance"
                                prefetch={false}
                                className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
                              >
                                Ver asistencias
                                <ArrowRight className="h-4 w-4" aria-hidden />
                              </Link>
                            </div>
                            <p className="text-xs text-slate-500">
                              Prioridad: llegadas tarde + ausencias sin
                              justificar × 2.
                            </p>
                            {peopleRank.length ? (
                              <div className="space-y-3">
                                {peopleRank.map((person) => (
                                  <PersonRankCard
                                    key={person.userId}
                                    p={person}
                                    onSelect={() => selectAnalyticsUser(person)}
                                  />
                                ))}
                              </div>
                            ) : (
                              <p className="py-6 text-center text-sm text-slate-500">
                                No hay personas en esta lista para los filtros
                                actuales.
                              </p>
                            )}
                          </section>
                          <section
                            className={cardClass}
                            aria-labelledby="analytics-events-title"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h2
                                id="analytics-events-title"
                                className="font-semibold text-slate-900"
                              >
                                Actividades para revisar
                              </h2>
                              <Link
                                href="/admin/events"
                                prefetch={false}
                                className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
                              >
                                Ver agendas
                                <ArrowRight className="h-4 w-4" aria-hidden />
                              </Link>
                            </div>
                            <p className="text-xs text-slate-500">
                              Índice: porcentaje de tardanzas + porcentaje de
                              ausencias.
                            </p>
                            {eventsRank.length ? (
                              <div className="space-y-3">
                                {eventsRank.map((event) => (
                                  <EventRankCard
                                    key={event.eventId}
                                    e={event}
                                  />
                                ))}
                              </div>
                            ) : (
                              <p className="py-6 text-center text-sm text-slate-500">
                                No hay actividades en esta lista para los
                                filtros actuales.
                              </p>
                            )}
                          </section>
                        </div>
                      </>
                    )}
                  </>
                )}
                <SettingsDetails
                  title="Detalles del cálculo"
                  description="Período, filtros y última actualización."
                >
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-slate-500">
                        Período analizado
                      </dt>
                      <dd className="mt-1 text-slate-700">
                        {ymdToDmy(dashboard.meta?.rangeFrom ?? from)}–
                        {ymdToDmy(dashboard.meta?.rangeTo ?? to)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">
                        Registros planificados
                      </dt>
                      <dd className="mt-1 text-slate-700">{resolvedCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Persona o rol</dt>
                      <dd className="mt-1 text-slate-700">
                        {selectedUserName || roleChipLabel(roleFilter)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Actividad</dt>
                      <dd className="mt-1 text-slate-700">
                        {eventType
                          ? getAdminEventTypeLabel(eventType)
                          : 'Todas las actividades'}
                      </dd>
                    </div>
                    {generatedLabel && (
                      <div>
                        <dt className="text-xs text-slate-500">
                          Última actualización
                        </dt>
                        <dd className="mt-1 text-slate-700">
                          {generatedLabel}
                        </dd>
                      </div>
                    )}
                  </dl>
                </SettingsDetails>
              </>
            )
          )}
        </div>
      </main>
    </RoleGuard>
  )
}
