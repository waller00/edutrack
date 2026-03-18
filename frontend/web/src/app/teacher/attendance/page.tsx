'use client'
import RoleGuard from '@/components/RoleGuard'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

type AttendanceRecord = {
  id: string
  type: 'CHECK_IN' | 'CHECK_OUT'
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'MEDICAL_LEAVE' | 'JUSTIFIED_ABSENCE'
  date: string
  time: string
  notes?: string
  event?: {
    id: string
    title: string
    type: string
  }
}

type Me = {
  id: string
  email: string
  role: 'TEACHER'
}

function getDefaultStartDate() {
  return `${new Date().getFullYear()}-01-01`
}

function getAttendanceTypeStyle(type: AttendanceRecord['type']) {
  return type === 'CHECK_IN' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
}

function getAttendanceTypeLabel(type: AttendanceRecord['type']) {
  return type === 'CHECK_IN' ? 'Entrada' : 'Salida'
}

function getAttendanceStatusStyle(status: AttendanceRecord['status']) {
  switch (status) {
    case 'PRESENT':
      return 'bg-green-100 text-green-800'
    case 'LATE':
      return 'bg-yellow-100 text-yellow-800'
    case 'MEDICAL_LEAVE':
      return 'bg-blue-100 text-blue-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

function getAttendanceStatusLabel(status: AttendanceRecord['status']) {
  switch (status) {
    case 'PRESENT':
      return 'Presente'
    case 'LATE':
      return 'Tarde'
    case 'MEDICAL_LEAVE':
      return 'Licencia Médica'
    case 'JUSTIFIED_ABSENCE':
      return 'Ausencia Justificada'
    default:
      return 'Ausente'
  }
}

export default function TeacherAttendance() {
  const [me, setMe] = useState<Me | null>(null)
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState(getDefaultStartDate())
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    api<Me>('/auth/me')
      .then((u) => {
        setMe(u)
        setLoading(false)
      })
      .catch(() => {
        window.location.href = '/login'
      })
  }, [])

  useEffect(() => {
    if (me) {
      loadAttendances()
    }
  }, [me, startDate, endDate])

  async function loadAttendances() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const query = params.toString()
      const data = await api<AttendanceRecord[]>(`/attendance/my-attendances${query ? `?${query}` : ''}`)
      setAttendances(data)
    } catch (error) {
      console.error('Error cargando asistencias:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <p>Cargando...</p>

  return (
    <RoleGuard allow={['TEACHER']}>
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
          <div className="text-sm text-gray-500">
            Total: {attendances.length} registros
          </div>
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

        {/* Tabla de asistencias */}
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="p-6 border-b">
            <h2 className="text-lg font-semibold">Registros de Asistencia</h2>
          </div>
          
          {attendances.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No hay registros de asistencia
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hora</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notas</th>
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
                          minute: '2-digit' 
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAttendanceTypeStyle(attendance.type)}`}>
                          {getAttendanceTypeLabel(attendance.type)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAttendanceStatusStyle(attendance.status)}`}>
                          {getAttendanceStatusLabel(attendance.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {attendance.notes || '-'}
                      </td>
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
