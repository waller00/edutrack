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

export default function StaffAttendance() {
  const [me, setMe] = useState<any>(null)
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/auth/me')
      .then((u: any) => {
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
  }, [me])

  async function loadAttendances() {
    setLoading(true)
    try {
      const data = await api('/attendance/my-attendances') as AttendanceRecord[]
      setAttendances(data)
    } catch (error) {
      console.error('Error cargando asistencias:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <p>Cargando...</p>

  return (
    <RoleGuard allow={['STAFF']}>
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
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          attendance.type === 'CHECK_IN' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {attendance.type === 'CHECK_IN' ? 'Entrada' : 'Salida'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          attendance.status === 'PRESENT' ? 'bg-green-100 text-green-800' :
                          attendance.status === 'LATE' ? 'bg-yellow-100 text-yellow-800' :
                          attendance.status === 'MEDICAL_LEAVE' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {attendance.status === 'PRESENT' ? 'Presente' :
                           attendance.status === 'LATE' ? 'Tarde' :
                           attendance.status === 'MEDICAL_LEAVE' ? 'Licencia Médica' :
                           attendance.status === 'JUSTIFIED_ABSENCE' ? 'Ausencia Justificada' :
                           'Ausente'}
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