'use client'

import RoleGuard from '@/components/RoleGuard'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import {
  getDefaultAttendanceStartDate,
  getAttendanceTypeStyle,
  getAttendanceTypeLabel,
  getAttendanceStatusStyle,
  getAttendanceStatusLabel,
  type MyAttendanceType,
  type MyAttendanceStatus,
} from '@/lib/my-attendance-display'

type AttendanceRecord = {
  id: string
  type: MyAttendanceType
  status: MyAttendanceStatus
  date: string
  time: string
  notes?: string
  event?: { id: string; title: string; type: string }
}

export default function MyAttendancePage({ role }: { role: 'TEACHER' | 'STAFF' }) {
  const [me, setMe] = useState<{ id: string } | null>(null)
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(getDefaultAttendanceStartDate())
  const [endDate, setEndDate] = useState('')
  const attendanceQuery = new URLSearchParams(
    [
      ['startDate', startDate],
      ['endDate', endDate],
    ].filter(([, value]) => Boolean(value))
  ).toString()

  useEffect(() => {
    api<{ id: string }>('/auth/me')
      .then((u: { id: string }) => {
        setMe(u)
        setLoading(false)
      })
      .catch(() => {
        window.location.href = '/login'
      })
  }, [])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const data = await api<AttendanceRecord[]>(
          attendanceQuery ? `/attendance/my-attendances?${attendanceQuery}` : '/attendance/my-attendances'
        )
        if (!cancelled) setAttendances(data)
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
  }, [me, attendanceQuery])

  if (loading) return <p>Cargando...</p>

  return (
    <RoleGuard allow={[role]}>
      <main className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <span className="text-emerald-600 text-xl">📊</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">Mis Asistencias</h1>
              <p className="text-sm text-gray-600">Consulta tu historial de asistencias</p>
            </div>
          </div>
          <div className="text-sm text-gray-500">Total: {attendances.length} registros</div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="bg-white border rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold">Registros de Asistencia</h2>
          </div>
          {attendances.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No hay registros de asistencia</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
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
                          {getAttendanceStatusLabel(attendance.status)}
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
