'use client'
import RoleGuard from '@/components/RoleGuard'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type License = {
  id: string
  userId: string
  type: 'MEDICAL_LEAVE' | 'WORK_LEAVE' | 'OTHER'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  startDate: string
  endDate: string
  reason: string
  doctorName?: string
  doctorPhone?: string
  certificate?: string
  approvedBy?: string
  approvedAt?: string
  notes?: string
  createdAt: string
  user: {
    id: string
    name: string
    email: string
    role: string
  }
}

type User = {
  id: string
  name: string
  email: string
  role: string
  firstName?: string
  lastName?: string
  username?: string
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<License | null>(null)
  const [message, setMessage] = useState('')
  const [filters, setFilters] = useState({
    userId: '',
    type: '',
    status: '',
    startDate: '',
    endDate: ''
  })

  const [newLicense, setNewLicense] = useState({
    userId: '',
    type: 'MEDICAL_LEAVE' as const,
    startDate: '',
    endDate: '',
    reason: '',
    doctorName: '',
    doctorPhone: '',
    notes: ''
  })

  useEffect(() => {
    loadLicenses()
    loadUsers()
  }, [])

  async function loadLicenses() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.type) params.set('type', filters.type)
      if (filters.status) params.set('status', filters.status)
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)

      const data = await api(`/medical-leaves/all?${params.toString()}`) as {
        data: License[]
      }
      
      setLicenses(data.data)
    } catch (error) {
      console.error('Error cargando licencias:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadUsers() {
    try {
      const data = await api('/admin/users?pageSize=100') as {
        data: User[]
      }
      // Procesar usuarios para tener el campo name
      const processedUsers = data.data.map(user => ({
        ...user,
        name: user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}` 
          : user.username || user.email
      }))
      setUsers(processedUsers)
    } catch (error) {
      console.error('Error cargando usuarios:', error)
    }
  }

  async function createLicense() {
    try {
      await api('/medical-leaves', {
        method: 'POST',
        body: JSON.stringify(newLicense)
      })
      
      setMessage('✅ Licencia creada correctamente')
      setCreating(false)
      setNewLicense({
        userId: '',
        type: 'MEDICAL_LEAVE',
        startDate: '',
        endDate: '',
        reason: '',
        doctorName: '',
        doctorPhone: '',
        notes: ''
      })
      await loadLicenses()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al crear licencia'}`)
    }
  }

  async function updateLicenseStatus(id: string, status: 'APPROVED' | 'REJECTED') {
    try {
      await api(`/medical-leaves/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      })
      
      setMessage(`✅ Licencia ${status === 'APPROVED' ? 'aprobada' : 'rechazada'} correctamente`)
      setEditing(null)
      await loadLicenses()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al actualizar licencia'}`)
    }
  }

  async function updateLicense() {
    if (!editing) return
    
    try {
      await api(`/medical-leaves/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          type: editing.type,
          startDate: editing.startDate,
          endDate: editing.endDate,
          reason: editing.reason,
          doctorName: editing.doctorName,
          doctorPhone: editing.doctorPhone,
          notes: editing.notes,
          status: editing.status
        })
      })
      
      setMessage('✅ Licencia actualizada correctamente')
      setEditing(null)
      await loadLicenses()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al actualizar licencia'}`)
    }
  }

  async function deleteLicense(id: string) {
    try {
      await api(`/medical-leaves/${id}`, { method: 'DELETE' })
      setMessage('✅ Licencia eliminada correctamente')
      await loadLicenses()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al eliminar licencia'}`)
    }
  }

  const getTypeLabel = (type: string) => {
    const labels: { [key: string]: string } = {
      'MEDICAL_LEAVE': 'Licencia Médica',
      'WORK_LEAVE': 'Licencia Laboral',
      'OTHER': 'Otro'
    }
    return labels[type] || type
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED': return 'bg-green-100 text-green-800'
      case 'REJECTED': return 'bg-red-100 text-red-800'
      case 'PENDING': return 'bg-yellow-100 text-yellow-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusLabel = (status: string) => {
    const labels: { [key: string]: string } = {
      'APPROVED': 'Aprobada',
      'REJECTED': 'Rechazada',
      'PENDING': 'Pendiente'
    }
    return labels[status] || status
  }

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-7xl p-6 space-y-8">
        {/* Header moderno */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <span className="text-emerald-600 text-xl">📄</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Gestión de Licencias</h1>
              <p className="text-gray-600">Control de licencias médicas y laborales</p>
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="btn-primary"
          >
            ➕ Nueva Licencia
          </button>
        </div>

        {message && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded text-blue-800">
            {message}
          </div>
        )}

        {/* Filtros */}
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Filtros</h2>
            <button
              onClick={() => {
                setFilters({
                  userId: '',
                  type: '',
                  status: '',
                  startDate: '',
                  endDate: ''
                })
              }}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded border"
            >
              Limpiar Filtros
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
              <select
                value={filters.userId}
                onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                <option value="MEDICAL_LEAVE">Licencia Médica</option>
                <option value="WORK_LEAVE">Licencia Laboral</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">Todos</option>
                <option value="PENDING">Pendiente</option>
                <option value="APPROVED">Aprobada</option>
                <option value="REJECTED">Rechazada</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
          
          <div className="mt-4">
            <button
              onClick={loadLicenses}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Aplicar Filtros
            </button>
          </div>
        </div>

        {/* Tabla de licencias */}
        <div className="bg-white border rounded-lg shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Período</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Motivo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      Cargando...
                    </td>
                  </tr>
                ) : licenses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      No hay licencias registradas
                    </td>
                  </tr>
                ) : (
                  licenses.map(license => (
                    <tr key={license.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {license.user.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getTypeLabel(license.type)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(license.startDate).toLocaleDateString('es-ES')} - {new Date(license.endDate).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(license.status)}`}>
                          {getStatusLabel(license.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {license.reason}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          {license.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => updateLicenseStatus(license.id, 'APPROVED')}
                                className="text-green-600 hover:text-green-900"
                              >
                                Aprobar
                              </button>
                              <button
                                onClick={() => updateLicenseStatus(license.id, 'REJECTED')}
                                className="text-red-600 hover:text-red-900"
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setEditing(license)}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => deleteLicense(license.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal para crear licencia */}
        {creating && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">Nueva Licencia</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
                  <select
                    value={newLicense.userId}
                    onChange={(e) => setNewLicense({ ...newLicense, userId: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Seleccionar usuario</option>
                    {users.map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Licencia</label>
                  <select
                    value={newLicense.type}
                    onChange={(e) => setNewLicense({ ...newLicense, type: e.target.value as any })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="MEDICAL_LEAVE">Licencia Médica</option>
                    <option value="WORK_LEAVE">Licencia Laboral</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
                    <input
                      type="date"
                      value={newLicense.startDate}
                      onChange={(e) => setNewLicense({ ...newLicense, startDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                    <input
                      type="date"
                      value={newLicense.endDate}
                      onChange={(e) => setNewLicense({ ...newLicense, endDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
                  <textarea
                    value={newLicense.reason}
                    onChange={(e) => setNewLicense({ ...newLicense, reason: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={3}
                  />
                </div>
                
                {newLicense.type === 'MEDICAL_LEAVE' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Doctor</label>
                      <input
                        type="text"
                        value={newLicense.doctorName}
                        onChange={(e) => setNewLicense({ ...newLicense, doctorName: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono del Doctor</label>
                      <input
                        type="text"
                        value={newLicense.doctorPhone}
                        onChange={(e) => setNewLicense({ ...newLicense, doctorPhone: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                  </>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas adicionales</label>
                  <textarea
                    value={newLicense.notes}
                    onChange={(e) => setNewLicense({ ...newLicense, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={2}
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => {
                    setCreating(false)
                    setNewLicense({
                      userId: '',
                      type: 'MEDICAL_LEAVE',
                      startDate: '',
                      endDate: '',
                      reason: '',
                      doctorName: '',
                      doctorPhone: '',
                      notes: ''
                    })
                  }}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={createLicense}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Crear Licencia
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal para ver detalles */}
        {editing && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">Editar Licencia</h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
                    <p className="text-sm text-gray-900">{editing.user.name}</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                    <select
                      value={editing.type}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option value="MEDICAL_LEAVE">Licencia Médica</option>
                      <option value="WORK_LEAVE">Licencia Laboral</option>
                      <option value="OTHER">Otro</option>
                    </select>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
                    <input
                      type="date"
                      value={editing.startDate.split('T')[0]}
                      onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                    <input
                      type="date"
                      value={editing.endDate.split('T')[0]}
                      onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <select
                    value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as any })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="PENDING">Pendiente</option>
                    <option value="APPROVED">Aprobado</option>
                    <option value="REJECTED">Rechazado</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
                  <textarea
                    value={editing.reason}
                    onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={3}
                  />
                </div>
                
                {editing.type === 'MEDICAL_LEAVE' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Doctor</label>
                      <input
                        type="text"
                        value={editing.doctorName || ''}
                        onChange={(e) => setEditing({ ...editing, doctorName: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono del Doctor</label>
                      <input
                        type="text"
                        value={editing.doctorPhone || ''}
                        onChange={(e) => setEditing({ ...editing, doctorPhone: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                  </>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                  <textarea
                    value={editing.notes || ''}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={3}
                  />
                </div>
                
                {editing.approvedBy && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Aprobado por</label>
                    <p className="text-sm text-gray-900">{editing.approvedBy}</p>
                  </div>
                )}
                
                {editing.approvedAt && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de aprobación</label>
                    <p className="text-sm text-gray-900">{new Date(editing.approvedAt).toLocaleDateString('es-ES')}</p>
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  onClick={updateLicense}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Guardar Cambios
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
