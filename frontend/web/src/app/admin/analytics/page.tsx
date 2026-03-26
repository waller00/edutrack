'use client'

import RoleGuard from '@/components/RoleGuard'
import { api } from '@/lib/api'
import { BarChart3 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type Role = 'ADMIN' | 'STAFF' | 'TEACHER'

type DashboardKpis = {
  M1_PUNCTUALITY_pct: number
  M2_LATE_RATE_pct: number
  M4_AOP_pct: number
  M6_COVERAGE_CP_pct: number
  M8_HOURS_DELTA_pct: number
  PC_count: number
}

type SeriesPoint = { period: string; value: number }

type DashboardResponse = {
  kpis: DashboardKpis
  series: {
    lateRateByPeriod: SeriesPoint[]
    aopByPeriod: SeriesPoint[]
  }
}

function formatPct(v: number) {
  return `${v.toFixed(2)}%`
}

function LineChart(props: { points: SeriesPoint[]; yLabel?: string }) {
  const { points } = props
  const w = 640
  const h = 140
  const pad = 18
  const values = points.map((p) => p.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 1)
  const span = max - min || 1

  const toX = (idx: number) => pad + (idx * (w - pad * 2)) / Math.max(1, points.length - 1)
  const toY = (v: number) => h - pad - ((v - min) * (h - pad * 2)) / span

  const path = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(idx)} ${toY(p.value)}`)
    .join(' ')

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="chart">
      <rect x="0" y="0" width={w} height={h} fill="white" />
      <path d={path} fill="none" stroke="#4f46e5" strokeWidth="2" />
      {points.map((p, idx) => (
        <circle key={p.period} cx={toX(idx)} cy={toY(p.value)} r="2.5" fill="#4f46e5" />
      ))}
    </svg>
  )
}

export default function AdminAnalyticsPage() {
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 6)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [role, setRole] = useState<Role>('STAFF')
  const [eventType, setEventType] = useState<string>('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

  async function loadDashboard() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        from,
        to,
        role,
      })
      if (eventType) params.set('eventType', eventType)

      const data = await api<DashboardResponse>(`/analytics/dashboard?${params.toString()}`)
      setDashboard(data)
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, role, eventType])

  const onExportAttendance = async (format: 'XLSX' | 'CSV') => {
    setError(null)
    const body = {
      reportKey: 'attendance_detail',
      format,
      from,
      to,
      filters: { role, eventType: eventType || undefined },
    }
    const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(body) })
    const exportId = res.exportId

    // Poll hasta DONE
    for (let i = 0; i < 30; i++) {
      const statusRes = await api<{ status: string; downloadUrl: string | null }>(`/exports/${exportId}`)
      if (statusRes.status === 'DONE') break
      await new Promise((r) => setTimeout(r, 250))
    }

    const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
    const blob = await dl.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = format === 'XLSX' ? `EduTrack_Asistencia_Detallada_${from}_${to}.xlsx` : `EduTrack_Asistencia_Detallada_${from}_${to}.csv`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const onExportMonthly = async () => {
    setError(null)
    const body = {
      reportKey: 'monthly_summary',
      format: 'PDF',
      from,
      to,
      filters: { role, eventType: eventType || undefined },
    }
    const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(body) })
    const exportId = res.exportId

    for (let i = 0; i < 30; i++) {
      const statusRes = await api<{ status: string; downloadUrl: string | null }>(`/exports/${exportId}`)
      if (statusRes.status === 'DONE') break
      await new Promise((r) => setTimeout(r, 250))
    }

    const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
    const blob = await dl.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `EduTrack_Asistencia_Resumen_Mensual_${from.slice(0, 7)}.pdf`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }

  const latePoints = dashboard?.series.lateRateByPeriod || []
  const aopPoints = dashboard?.series.aopByPeriod || []

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-7xl p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <BarChart3 className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Analytics EduTrack</h1>
              <p className="text-gray-600">KPIs y exportación de asistencia (Fase 1)</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700" disabled={loading} onClick={() => onExportAttendance('XLSX')}>
              Export XLSX
            </button>
            <button className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700" disabled={loading} onClick={() => onExportAttendance('CSV')}>
              Export CSV
            </button>
            <button className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700" disabled={loading} onClick={() => onExportMonthly()}>
              Export PDF Mensual
            </button>
          </div>
        </div>

        <div className="bg-white border rounded-lg p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">Filtros</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full border border-gray-300 rounded px-3 py-2">
                <option value="STAFF">STAFF</option>
                <option value="TEACHER">TEACHER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo Evento</label>
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2">
                <option value="">Todos</option>
                <option value="JORNADA_LABORAL">JORNADA_LABORAL</option>
                <option value="REUNION">REUNION</option>
                <option value="CLASE">CLASE</option>
                <option value="EVENTO">EVENTO</option>
                <option value="CAPACITACION">CAPACITACION</option>
                <option value="CITA_MEDICA">CITA_MEDICA</option>
              </select>
            </div>
          </div>
        </div>

        {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>}

        {!dashboard && loading && <div className="text-gray-600">Cargando analytics...</div>}

        {dashboard && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-white border rounded-lg shadow-sm">
                <div className="text-sm text-gray-600">Puntualidad (Entrada a tiempo)</div>
                <div className="text-2xl font-bold text-indigo-600">{formatPct(dashboard.kpis.M1_PUNCTUALITY_pct)}</div>
              </div>
              <div className="p-4 bg-white border rounded-lg shadow-sm">
                <div className="text-sm text-gray-600">Tasa LATE</div>
                <div className="text-2xl font-bold text-yellow-600">{formatPct(dashboard.kpis.M2_LATE_RATE_pct)}</div>
              </div>
              <div className="p-4 bg-white border rounded-lg shadow-sm">
                <div className="text-sm text-gray-600">Ausentismo sobre plan (AOP)</div>
                <div className="text-2xl font-bold text-red-600">{formatPct(dashboard.kpis.M4_AOP_pct)}</div>
              </div>
              <div className="p-4 bg-white border rounded-lg shadow-sm">
                <div className="text-sm text-gray-600">Cobertura real (CP)</div>
                <div className="text-2xl font-bold text-emerald-600">{formatPct(dashboard.kpis.M6_COVERAGE_CP_pct)}</div>
              </div>
              <div className="p-4 bg-white border rounded-lg shadow-sm">
                <div className="text-sm text-gray-600">Δ Horas vs plan (%)</div>
                <div className="text-2xl font-bold text-indigo-700">{formatPct(dashboard.kpis.M8_HOURS_DELTA_pct)}</div>
              </div>
              <div className="p-4 bg-white border rounded-lg shadow-sm">
                <div className="text-sm text-gray-600">Licencias inactivas</div>
                <div className="text-2xl font-bold text-red-700">{dashboard.kpis.PC_count}</div>
              </div>
            </div>

            <div className="bg-white border rounded-lg p-6 shadow-sm">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Late rate por semana</h3>
                  <LineChart points={latePoints} />
                </div>
                <div>
                  <h3 className="font-semibold mb-2">AOP por semana</h3>
                  <LineChart points={aopPoints} />
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </RoleGuard>
  )
}
