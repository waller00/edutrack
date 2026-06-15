'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { BarChart3 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api/client'
import { useAuth } from '@/contexts/AuthContext'
import MyAttendanceMarkingPanel from '@/components/personal/MyAttendanceMarkingPanel'
import AttendanceHeatmap from '@/components/admin/AttendanceHeatmap'
import { getTodayYmdInUruguay } from '@/lib/forms/datetime-uy'
import type { AttendanceSummaryResponse, AttendanceSummaryPerson } from '@/lib/attendance/summary'
import {
  getDefaultAttendanceStartDate,
  getAttendanceTypeStyle,
  getAttendanceTypeLabel,
  getAttendanceStatusStyle,
  getAttendanceStatusLabelForType,
  type MyAttendanceType,
  type MyAttendanceStatus,
} from '@/lib/attendance/my-attendance-display'

type AttendanceRecord = {
  id: string
  type: MyAttendanceType
  status: MyAttendanceStatus
  date: string
  time: string
  notes?: string
  event?: { id: string; title: string; type: string }
}

function getAttendanceRowStatusLabel(attendance: AttendanceRecord) {
  if (attendance.status === 'LATE' && attendance.notes?.toLowerCase().includes('llegada muy tarde')) {
    return 'Llegada muy tarde'
  }
  return getAttendanceStatusLabelForType(attendance.type, attendance.status)
}

export default function MyAttendancePage(_props: { role?: 'TEACHER' | 'STAFF' } = {}) {
  const { me: authUser, loading: authLoading } = useAuth()
  const userId = authUser?.id ?? null
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(getDefaultAttendanceStartDate())
  const [endDate, setEndDate] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [summary, setSummary] = useState<AttendanceSummaryPerson | null>(null)
  const attendanceQuery = new URLSearchParams(
    [
      ['startDate', startDate],
      ['endDate', endDate],
      ['includeAbsences', 'true'],
    ].filter(([, value]) => Boolean(value))
  ).toString()

  useEffect(() => {
    if (!authLoading && !authUser) globalThis.location.href = '/login'
  }, [authLoading, authUser])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const data = await api<AttendanceRecord[]>(
          attendanceQuery ? `/attendance/my-attendances?${attendanceQuery}` : '/attendance/my-attendances'
        )
        if (!cancelled) setAttendances(Array.isArray(data) ? data : [])
      } catch (e) {
        console.error('Error cargando asistencias:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [userId, attendanceQuery, refreshKey])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function loadSummary() {
      try {
        const params = new URLSearchParams()
        if (startDate) params.set('from', startDate)
        params.set('to', endDate || getTodayYmdInUruguay())
        const qs = params.toString()
        const data = await api<AttendanceSummaryResponse>(`/attendance/summary?${qs}`)
        if (!cancelled) setSummary(data.person ?? null)
      } catch (e) {
        console.error('Error cargando resumen:', e)
        if (!cancelled) setSummary(null)
      }
    }
    void loadSummary()
    return () => {
      cancelled = true
    }
  }, [userId, startDate, endDate, refreshKey])

  if (loading) return <p>Cargando...</p>

  return (
    <RoleGuard permission="attendance.read" permissionScope="own">
      <main className="responsive-page max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <BarChart3 className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Mis Asistencias</h1>
              <p className="text-sm text-gray-600">Consulta tu historial de asistencias</p>
            </div>
          </div>
          <div className="text-sm text-gray-500">Total: {attendances.length} registros</div>
        </div>

        {userId ? <MyAttendanceMarkingPanel userId={userId} onMarked={() => setRefreshKey((k) => k + 1)} /> : null}

        {summary ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">% Asistencia</div>
                <div className="text-xl font-bold text-emerald-600">{summary.stats.pctAsistencia}%</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">% Puntualidad</div>
                <div className="text-xl font-bold text-emerald-600">{summary.stats.pctPuntualidad}%</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Tarde</div>
                <div className="text-xl font-bold text-amber-600">{summary.stats.tarde}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">Faltas sin justificar</div>
                <div className="text-xl font-bold text-red-600">{summary.stats.ausenteNoJustificado}</div>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Mapa de asistencia</h2>
              <AttendanceHeatmap
                rows={summary.rows}
                from={startDate || `${(endDate || getTodayYmdInUruguay()).slice(0, 4)}-01-01`}
                to={endDate || getTodayYmdInUruguay()}
              />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="my-attendance-start-date" className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
            <input
              id="my-attendance-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="my-attendance-end-date" className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
            <input
              id="my-attendance-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="bg-white border rounded-lg shadow-sm">
          <div className="border-b p-4 sm:p-6">
            <h2 className="text-lg font-semibold">Registros de Asistencia</h2>
          </div>
          {attendances.length === 0 ? (
            <div className="p-4 text-center text-gray-500 sm:p-6">No hay registros de asistencia</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Fecha
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Hora
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Tipo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Estado
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Notas
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {attendances.map((attendance) => (
                    <tr key={attendance.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(attendance.date).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(attendance.time).toLocaleTimeString('es-ES', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getAttendanceTypeStyle(attendance.type)}`}
                        >
                          {getAttendanceTypeLabel(attendance.type)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getAttendanceStatusStyle(attendance.status)}`}
                        >
                          {getAttendanceRowStatusLabel(attendance)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">{attendance.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </RoleGuard>
  )
}
