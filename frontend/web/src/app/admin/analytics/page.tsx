'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { getAdminEventTypeLabel } from '@/lib/admin/events-display'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import {
  ArrowRight,
  BarChart3,
  Calendar,
  FileSpreadsheet,
  FileText,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

type OrgRoleFilter = 'ADMIN' | 'STAFF' | 'TEACHER'

const EVENT_TYPES = ['JORNADA_LABORAL', 'REUNION', 'CLASE'] as const

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

type DashboardResponse = {
  meta?: DashboardMeta
  kpis: DashboardKpis
  series: {
    lateRateByPeriod: SeriesPoint[]
    aopByPeriod: SeriesPoint[]
  }
  topLists?: {
    topRiskPeople: TopRiskPerson[]
    topRiskEvents: TopRiskEvent[]
  }
}

function formatPct(v: number) {
  return `${v.toFixed(2)}%`
}

function formatUtcDayLabel(isoDate: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) return isoDate
  const [, y, mo, d] = m
  return `${d}/${mo}`
}

/** Gráfico de serie con cuadrícula suave: pensado para indicadores %. */
function WeeklyTrendChart(props: {
  points: SeriesPoint[]
  stroke: string
  fill: string
  title: string
  unitSuffix?: string
}) {
  const { points, stroke, fill, title, unitSuffix = '%' } = props
  const w = 640
  const h = 208
  const padL = 44
  const padR = 14
  const padT = 18
  const padB = 36

  const values = points.map((p) => p.value)
  const dataMax = Math.max(...values, 0)
  const minY = 0
  const maxYRaw = Math.max(18, Math.ceil((Math.max(dataMax, 5) / 5) * 5 * 1.12))
  const maxY = Math.min(118, Math.round(maxYRaw))
  const spanY = Math.max(maxY - minY, 1)

  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const toX = (idx: number) => padL + (idx * innerW) / Math.max(1, points.length - 1)
  const toY = (v: number) => padT + innerH - ((v - minY) * innerH) / spanY

  const yDivisions = 4
  const yAxisTicks = Array.from({ length: yDivisions + 1 }, (_, i) => {
    const val = minY + (spanY * i) / yDivisions
    const rounded = Math.round(val * 100) / 100
    const lbl = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
    return { yPx: toY(val), label: lbl }
  })

  const gradId = stroke.replace(/[^a-zA-Z0-9]/g, '')

  const linePath =
    points.length === 0
      ? ''
      : points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(idx)} ${toY(Math.min(Math.max(p.value, minY), maxY))}`).join(' ')

  let areaPath = ''
  if (points.length > 0 && linePath) {
    const ix0 = toX(0)
    const ix1 = toX(points.length - 1)
    const baseY = padT + innerH
    areaPath = `${linePath} L ${ix1} ${baseY} L ${ix0} ${baseY} Z`
  }

  if (points.length === 0) {
    return (
      <div role="figure" aria-label={title}>
        <p className="py-12 text-center text-sm text-gray-500">No hay suficientes semanas para graficar en el rango.</p>
      </div>
    )
  }

  return (
    <figure className="w-full">
      <svg
        width="100%"
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className="max-w-full"
        role="img"
        aria-label={title}
      >
        <defs>
          <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity="0.55" />
            <stop offset="100%" stopColor={fill} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <rect x="0.5" y="0.5" width={w - 1} height={h - 1} fill="#fafafa" rx="12" ry="12" stroke="#e5e7eb" />

        {[0.25, 0.5, 0.75].map((f) => {
          const y = padT + innerH * f
          return <line key={f} x1={padL} y1={y} x2={w - padR} y2={y} stroke="#e8e8e8" strokeDasharray="4 6" strokeWidth={1} />
        })}

        {yAxisTicks.map((t, i) => (
          <g key={`y-${String(i)}-${t.label}`}>
            <line x1={padL - 4} y1={t.yPx} x2={padL} y2={t.yPx} stroke="#dbeafe" strokeWidth={1} />
            <text x={padL - 8} y={t.yPx + 4} fontSize={10} textAnchor="end" fill="#64748b">
              {t.label}
              {unitSuffix}
            </text>
          </g>
        ))}

        {areaPath ? <path d={areaPath} fill={`url(#grad-${gradId})`} stroke="none" /> : null}
        <path d={linePath} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, idx) => (
          <g key={`${p.period}-${idx}`}>
            <circle
              cx={toX(idx)}
              cy={toY(Math.min(Math.max(p.value, minY), maxY))}
              r={4}
              fill="white"
              stroke={stroke}
              strokeWidth={2}
            />
            <title>{`Semana ${formatUtcDayLabel(p.period)}: ${formatPct(p.value)}`}</title>
          </g>
        ))}

        {points.map((p, idx) => (
          <text key={`lab-${p.period}-${idx}`} x={toX(idx)} y={h - 14} fontSize={10} textAnchor="middle" fill="#4b5563">
            {formatUtcDayLabel(p.period)}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2 text-xs text-gray-500">
        Vista semanal definida desde el lunes (UTC); cada marca corresponde al inicio de esa semana.
      </figcaption>
    </figure>
  )
}

type KpiTone = 'emerald' | 'amber' | 'red' | 'slate'

function KpiCard(props: {
  label: string
  hint?: string
  value: ReactNode
  foot?: string
  tone: KpiTone
}) {
  const toneMap: Record<KpiTone, string> = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-700',
    red: 'text-red-600',
    slate: 'text-slate-900',
  }
  const { label, hint, value, foot, tone } = props

  return (
    <article className="flex flex-col justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div>
        <h3 title={hint} className="text-sm font-medium text-gray-600">
          {label}
          {hint ? <span className="ml-1 cursor-help text-gray-400">ⓘ</span> : null}
        </h3>
        <p className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${toneMap[tone]}`}>{value}</p>
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
      return 'Equipo administrativo'
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

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [exportingKind, setExportingKind] = useState<'xlsx' | 'csv' | 'pdf' | null>(null)
  const [exportNotice, setExportNotice] = useState<string>('')

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
  const analyticsSchoolYearId = syCtx?.selectedId ?? syCtx?.activeId ?? null

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      if (roleFilter) params.set('role', roleFilter)
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
  }, [from, to, roleFilter, eventType, syCtx?.allYears, analyticsSchoolYearId])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const decisionSignals = useMemo(() => {
    if (!dashboard) return []
    return buildDecisionSignals(dashboard)
  }, [dashboard])

  const resolvedCount = dashboard?.meta?.resolvedInstanceCount ?? 0
  const generatedLabel = dashboard?.meta?.generatedAt
    ? new Intl.DateTimeFormat('es-UY', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(
        new Date(dashboard.meta.generatedAt),
      ) + ' UTC'
    : null

  const runExportAttendance = async (format: 'XLSX' | 'CSV') => {
    setExportNotice('')
    const kind = format === 'XLSX' ? 'xlsx' : 'csv'
    setExportingKind(kind)
    setError(null)
    try {
      const body = {
        reportKey: 'attendance_detail',
        format,
        from,
        to,
        filters: {
          ...(roleFilter ? { role: roleFilter } : {}),
          ...(eventType ? { eventType } : {}),
          ...(syCtx?.allYears ? { allYears: '1' } : {}),
          ...(!syCtx?.allYears && analyticsSchoolYearId ? { schoolYearId: analyticsSchoolYearId } : {}),
        },
      }
      const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(body) })
      const exportId = res.exportId

      let exportDone = false
      for (let i = 0; i < 30; i++) {
        const statusRes = await api<{ status: string; downloadUrl: string | null; errorMessage?: string }>(`/exports/${exportId}`)
        if (statusRes.status === 'DONE') {
          exportDone = true
          break
        }
        if (statusRes.status === 'FAILED') throw new Error(statusRes.errorMessage || 'Error generando export')
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!exportDone) throw new Error('El export tardó demasiado en generarse')

      const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
      if (!dl.ok) throw new Error(`Error descargando export: ${dl.status}`)
      const blob = await dl.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        format === 'XLSX'
          ? `EduTrack_Asistencia_detallada_${from}_${to}.xlsx`
          : `EduTrack_Asistencia_detallada_${from}_${to}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setExportNotice(`✅ Exportación ${format} lista.`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error exportando.'
      setError(msg)
    } finally {
      setExportingKind(null)
    }
  }

  const runExportMonthly = async () => {
    setExportNotice('')
    setExportingKind('pdf')
    setError(null)
    try {
      const body = {
        reportKey: 'monthly_summary',
        format: 'PDF',
        from,
        to,
        filters: {
          ...(roleFilter ? { role: roleFilter } : {}),
          ...(eventType ? { eventType } : {}),
          ...(syCtx?.allYears ? { allYears: '1' } : {}),
          ...(!syCtx?.allYears && analyticsSchoolYearId ? { schoolYearId: analyticsSchoolYearId } : {}),
        },
      }
      const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(body) })
      const exportId = res.exportId

      let exportDone = false
      for (let i = 0; i < 30; i++) {
        const statusRes = await api<{ status: string; downloadUrl: string | null; errorMessage?: string }>(`/exports/${exportId}`)
        if (statusRes.status === 'DONE') {
          exportDone = true
          break
        }
        if (statusRes.status === 'FAILED') throw new Error(statusRes.errorMessage || 'Error generando export')
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!exportDone) throw new Error('El export tardó demasiado en generarse')

      const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
      if (!dl.ok) throw new Error(`Error descargando export: ${dl.status}`)
      const blob = await dl.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `EduTrack_Resumen_mensual_${from.slice(0, 7)}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setExportNotice('✅ PDF mensual listo.')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error exportando PDF.'
      setError(msg)
    } finally {
      setExportingKind(null)
    }
  }

  function clearFiltersAndReload() {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 29)
    setFrom(d.toISOString().slice(0, 10))
    setTo(new Date().toISOString().slice(0, 10))
    setRoleFilter('')
    setEventType('')
    setExportNotice('')
  }

  const latePoints = dashboard?.series.lateRateByPeriod ?? []
  const aopPoints = dashboard?.series.aopByPeriod ?? []
  const peopleRank = dashboard?.topLists?.topRiskPeople ?? []
  const eventsRank = dashboard?.topLists?.topRiskEvents ?? []

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
                    <span className="ml-2 font-semibold">{roleChipLabel(roleFilter)}</span>
                  </div>
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
                Excel
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
                CSV
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
            </div>
            <p className="max-w-sm text-right text-xs text-gray-500">
              Las exportaciones reutilizan el motor institucional de reportes sobre el mismo rango vigente.</p>
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-1">
              <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Desde (período)
              </label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Hasta (período)
              </label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Rol asignado al evento</label>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="select-field">
                <option value="">Todos los roles</option>
                <option value="TEACHER">Docentes</option>
                <option value="STAFF">Equipo administrativo</option>
                <option value="ADMIN">Administradores</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Equivalente operativo del filtro utilizado también en otros módulos de control de personal.
              </p>
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
                />
                <KpiCard
                  label="Llegadas tarde"
                  hint="Porcentaje de entradas con estado tardío dentro del período seleccionado."
                  tone="amber"
                  value={formatPct(dashboard.kpis.M2_LATE_RATE_pct)}
                  foot="Indicador de disciplina horaria inicial"
                />
                <KpiCard
                  label="Ausencias no cubiertas / plan"
                  hint="Ausencias efectivas contra instancias programadas incluidas en el período."
                  tone="red"
                  value={formatPct(dashboard.kpis.M4_AOP_pct)}
                  foot="Ausentismo efectivo institucional"
                />
                <KpiCard
                  label="Cobertura de presencia efectiva"
                  hint="Combinación entrada/salida que cubra la sesión institucional modelada."
                  tone="emerald"
                  value={formatPct(dashboard.kpis.M6_COVERAGE_CP_pct)}
                  foot="Señal integral de ocupación efectiva del bloque planificado"
                />
                <KpiCard
                  label="Desvío temporal vs planificado"
                  hint="Relación tiempos observados contra ventana institucional reservada (horas efectivas)."
                  tone="slate"
                  value={formatPct(dashboard.kpis.M8_HOURS_DELTA_pct)}
                  foot="Interpretación relativa sin escala absoluta institucional fija"
                />
                <KpiCard label="Licencias inactivas" tone="slate" value={dashboard.kpis.PC_count} foot="Rango solapante con período solicitado (contexto médico)." />
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
                  <div className="overflow-hidden rounded-xl border border-gray-100">
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
                                  className={`inline-flex min-w-[2.5rem] justify-end rounded-full px-2 py-1 text-xs font-bold tabular-nums ${
                                    p.riskScore > 8 ? 'bg-red-50 text-red-800' : p.riskScore > 3 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'
                                  }`}
                                >
                                  {p.riskScore}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
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
                  <div className="overflow-hidden rounded-xl border border-gray-100">
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
                )}
              </section>
            </div>

            <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="series-heading">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-4">
                <div>
                  <h2 id="series-heading" className="text-lg font-semibold text-gray-900">
                    Trayectorias semanales
                  </h2>
                  <p className="mt-1 max-w-prose text-sm text-gray-600">
                    Serie construida con la misma lógica de conciliación usada por exportaciones; sirve comparar períodos institucionalmente relativos dentro de EduTrack, no benchmarking externo.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-base font-semibold text-gray-800">Trayectoria de tardanza</h3>
                  <p className="mb-4 text-xs text-gray-500">Comparativo semanal tasa llegadas tarde (registradas válidas sólo entrada).</p>
                  <WeeklyTrendChart
                    points={latePoints}
                    stroke="#ea580c"
                    fill="#fb923c"
                    title="Evolución de la tasa de llegadas tardías por semana"
                  />
                </div>
                <div>
                  <h3 className="mb-1 text-base font-semibold text-gray-800">Trayectoria de ausentismo</h3>
                  <p className="mb-4 text-xs text-gray-500">Variación institucional de ausencias efectivamente reflejadas sobre plan semanalizado.</p>
                  <WeeklyTrendChart
                    points={aopPoints}
                    stroke="#dc2626"
                    fill="#f87171"
                    title="Evolución de ausentismo planificado efectivo vs plan semanalizado"
                  />
                </div>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </RoleGuard>
  )
}
