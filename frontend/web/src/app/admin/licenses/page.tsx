'use client'
import DateRangeFields from '@/components/DateRangeFields'
import MedicalLeaveCertificateLink from '@/components/MedicalLeaveCertificateLink'
import RoleGuard from '@/components/RoleGuard'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import {
  buildMedicalLeavesQueryString,
  formatLicenseAdminUserDisplayName,
  getLicenseAdminDefaultStartDate,
  getLicenseStatusBadgeClass,
  getLicenseStatusLabel,
  getLicenseTypeLabel,
} from '@/lib/admin-licenses-display'
import {
  medicalLeaveCertificateAcceptAttr,
  readMedicalLeaveCertificateFile,
  certificateHasValue,
} from '@/lib/medical-leave-certificate-client'
import { formatValidationErrorFromApi } from '@/lib/api-validation-message'
import { getAdminFlashMessageClass } from '@/lib/admin-ui-helpers'

type License = {
  id: string
  userId: string
  type: 'MEDICAL_LEAVE' | 'WORK_LEAVE' | 'OTHER'
  status: 'ACTIVE' | 'INACTIVE'
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

function datePartsToIsoUtcNoon(dateYmd: string): string {
  if (!dateYmd) return ''
  const day = dateYmd.includes('T') ? dateYmd.slice(0, 10) : dateYmd
  return new Date(`${day}T12:00:00.000Z`).toISOString()
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<License | null>(null)
  /** Errores de validación/API solo dentro del modal de alta (no detrás del overlay). */
  const [createModalError, setCreateModalError] = useState('')
  const [editModalError, setEditModalError] = useState('')
  const [message, setMessage] = useState('')
  const [selectedLicenseIds, setSelectedLicenseIds] = useState<string[]>([])
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [filters, setFilters] = useState({
    userId: '',
    type: '',
    status: '',
    startDate: getLicenseAdminDefaultStartDate(),
    endDate: ''
  })

  const [newLicense, setNewLicense] = useState({
    userId: '',
    type: 'MEDICAL_LEAVE' as License['type'],
    startDate: '',
    endDate: '',
    reason: '',
    notes: '',
    doctorName: '',
    doctorPhone: '',
    certificate: '' as string,
    certificateFileLabel: '' as string,
  })
  const [newCertificateUrl, setNewCertificateUrl] = useState('')

  useEffect(() => {
    loadLicenses()
    loadUsers()
  }, [])

  useEffect(() => {
    setSelectedLicenseIds([])
  }, [licenses])

  async function loadLicenses() {
    setLoading(true)
    try {
      const qs = buildMedicalLeavesQueryString(filters)
      const data = await api<{
        data: License[]
      }>(`/medical-leaves/all?${qs}`)
      
      setLicenses(data.data)
    } catch (error) {
      console.error('Error cargando licencias:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadUsers() {
    try {
      const data = await api<{
        data: User[]
      }>('/admin/users?pageSize=100')
      // Procesar usuarios para tener el campo name
      const processedUsers = data.data.map((user) => ({
        ...user,
        name: formatLicenseAdminUserDisplayName(user),
      }))
      setUsers(processedUsers)
    } catch (error) {
      console.error('Error cargando usuarios:', error)
    }
  }

  async function createLicense() {
    setCreateModalError('')
    if (!newLicense.userId.trim()) {
      setCreateModalError('❌ Usuario: elegí a quién corresponde la licencia.')
      return
    }
    if (!newLicense.startDate || !newLicense.endDate) {
      setCreateModalError('❌ Fechas: completá la fecha de inicio y la de fin.')
      return
    }
    if (!newLicense.reason.trim()) {
      setCreateModalError('❌ Motivo: no puede estar vacío.')
      return
    }

    try {
      const cert =
        newLicense.certificate.trim() ||
        newCertificateUrl.trim() ||
        undefined
      await api('/medical-leaves', {
        method: 'POST',
        body: JSON.stringify({
          userId: newLicense.userId,
          type: newLicense.type,
          startDate: datePartsToIsoUtcNoon(newLicense.startDate),
          endDate: datePartsToIsoUtcNoon(newLicense.endDate),
          reason: newLicense.reason,
          notes: newLicense.notes.trim() || undefined,
          doctorName:
            newLicense.type === 'MEDICAL_LEAVE' && newLicense.doctorName.trim()
              ? newLicense.doctorName.trim()
              : undefined,
          doctorPhone:
            newLicense.type === 'MEDICAL_LEAVE' && newLicense.doctorPhone.trim()
              ? newLicense.doctorPhone.trim()
              : undefined,
          certificate: cert,
        }),
      })

      setCreateModalError('')
      setMessage('✅ Licencia creada correctamente')
      setCreating(false)
      setNewCertificateUrl('')
      setNewLicense({
        userId: '',
        type: 'MEDICAL_LEAVE',
        startDate: '',
        endDate: '',
        reason: '',
        notes: '',
        doctorName: '',
        doctorPhone: '',
        certificate: '',
        certificateFileLabel: '',
      })
      await loadLicenses()
    } catch (error: unknown) {
      setCreateModalError(formatValidationErrorFromApi(error) || '❌ Error al crear licencia')
    }
  }

  async function updateLicense() {
    if (!editing) return

    setEditModalError('')
    if (!editing.reason?.trim()) {
      setEditModalError('❌ Motivo: no puede estar vacío.')
      return
    }

    try {
      await api(`/medical-leaves/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          type: editing.type,
          startDate: datePartsToIsoUtcNoon(editing.startDate.split('T')[0] || editing.startDate),
          endDate: datePartsToIsoUtcNoon(editing.endDate.split('T')[0] || editing.endDate),
          reason: editing.reason,
          doctorName: editing.doctorName,
          doctorPhone: editing.doctorPhone,
          notes: editing.notes,
          certificate: editing.certificate?.trim() ? editing.certificate.trim() : null,
        }),
      })
      
      setEditModalError('')
      setMessage('✅ Licencia actualizada correctamente')
      setEditing(null)
      await loadLicenses()
    } catch (error: unknown) {
      setEditModalError(formatValidationErrorFromApi(error) || '❌ Error al actualizar licencia')
    }
  }

  async function deleteSelectedLicenses() {
    if (selectedLicenseIds.length === 0) return
    if (!confirm(`¿Estás seguro de eliminar ${selectedLicenseIds.length} licencias seleccionadas?`)) return

    setDeletingSelected(true)
    setMessage('')
    try {
      await Promise.all(selectedLicenseIds.map((id) => api(`/medical-leaves/${id}`, { method: 'DELETE' })))
      setMessage(`✅ Se eliminaron ${selectedLicenseIds.length} licencias seleccionadas`)
      setSelectedLicenseIds([])
      await loadLicenses()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al eliminar licencias seleccionadas'}`)
    } finally {
      setDeletingSelected(false)
    }
  }

  function toggleLicenseSelection(id: string) {
    setSelectedLicenseIds((prev) =>
      prev.includes(id) ? prev.filter((currentId) => currentId !== id) : [...prev, id],
    )
  }

  function toggleAllLicensesSelection() {
    const selectableIds = licenses.filter((license) => license.status !== 'INACTIVE').map((license) => license.id)
    setSelectedLicenseIds((prev) => (prev.length === selectableIds.length ? [] : selectableIds))
  }

  function renderLicensesRows() {
    if (loading) {
      return (
        <tr>
          <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
            Cargando...
          </td>
        </tr>
      )
    }

    if (licenses.length === 0) {
      return (
        <tr>
          <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
            No hay licencias registradas
          </td>
        </tr>
      )
    }

    return licenses.map(license => (
      <tr key={license.id}>
        <td className="px-6 py-4 whitespace-nowrap text-sm">
          <input
            type="checkbox"
            checked={selectedLicenseIds.includes(license.id)}
            onChange={() => toggleLicenseSelection(license.id)}
            disabled={license.status === 'INACTIVE'}
            aria-label={`Seleccionar licencia de ${license.user.name}`}
          />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          {license.user.name}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          {getLicenseTypeLabel(license.type)}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          {new Date(license.startDate).toLocaleDateString('es-ES')} - {new Date(license.endDate).toLocaleDateString('es-ES')}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getLicenseStatusBadgeClass(license.status)}`}>
            {getLicenseStatusLabel(license.status)}
          </span>
        </td>
        <td className="px-6 py-4 text-sm text-gray-900">
          {license.reason}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm">
          <MedicalLeaveCertificateLink
            certificate={license.certificate}
            linkClassName="text-indigo-600 hover:text-indigo-800 font-medium"
          />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm">
          <div className="flex gap-2">
            <button
              onClick={() => {
                setEditModalError('')
                setEditing({
                  ...license,
                  certificate: license.certificate ?? '',
                })
              }}
              className="text-indigo-600 hover:text-indigo-900"
            >
              Editar
            </button>
          </div>
        </td>
      </tr>
    ))
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
              <h1 className="text-3xl font-bold text-gray-900">Gestión de licencias</h1>
              <p className="text-gray-600 max-w-2xl">
                Registro centralizado por la dirección o administración. El personal solo consulta sus licencias en
                su panel. Las licencias activas se reflejan en la justificación de inasistencias cuando corresponde.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateModalError('')
              setCreating(true)
            }}
            className="btn-primary"
          >
            ➕ Nueva Licencia
          </button>
        </div>

        {message && !creating && !editing && (
          <div
            className={`whitespace-pre-line p-4 border rounded ${getAdminFlashMessageClass(message)}`}
            role="alert"
          >
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
                  startDate: getLicenseAdminDefaultStartDate(),
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
                <option value="ACTIVE">Activa</option>
                <option value="INACTIVE">Inactiva</option>
              </select>
            </div>
            
            <DateRangeFields
              startDate={filters.startDate}
              endDate={filters.endDate}
              onStartDateChange={(value) => setFilters({ ...filters, startDate: value })}
              onEndDateChange={(value) => setFilters({ ...filters, endDate: value })}
            />
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
          <div className="p-6 border-b flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-semibold">Licencias</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-500">
                {selectedLicenseIds.length === 0
                  ? 'Selecciona licencias activas para eliminarlas'
                  : `${selectedLicenseIds.length} seleccionadas`}
              </span>
              <button
                type="button"
                onClick={deleteSelectedLicenses}
                disabled={selectedLicenseIds.length === 0 || deletingSelected}
                className="inline-flex items-center rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingSelected ? 'Eliminando...' : 'Eliminar seleccionadas'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    <input
                      type="checkbox"
                      checked={
                        licenses.some((license) => license.status !== 'INACTIVE')
                        && selectedLicenseIds.length === licenses.filter((license) => license.status !== 'INACTIVE').length
                      }
                      onChange={toggleAllLicensesSelection}
                      aria-label="Seleccionar todas las licencias"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Período</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Motivo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Certificado</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {renderLicensesRows()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal para crear licencia */}
        {creating && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
              <h3 className="text-lg font-semibold mb-4">Nueva Licencia</h3>

              {createModalError ? (
                <div
                  className={`mb-4 whitespace-pre-line rounded border p-3 text-sm ${getAdminFlashMessageClass(createModalError)}`}
                  role="alert"
                >
                  {createModalError}
                </div>
              ) : null}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
                  <select
                    aria-label="Usuario de licencia"
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
                    aria-label="Tipo de licencia"
                    value={newLicense.type}
                    onChange={(e) => {
                      const type = e.target.value as License['type']
                      setNewLicense({
                        ...newLicense,
                        type,
                        ...(type !== 'MEDICAL_LEAVE'
                          ? {
                              doctorName: '',
                              doctorPhone: '',
                              certificate: '',
                              certificateFileLabel: '',
                            }
                          : {}),
                      })
                      if (type !== 'MEDICAL_LEAVE') setNewCertificateUrl('')
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="MEDICAL_LEAVE">Licencia Médica</option>
                    <option value="WORK_LEAVE">Licencia Laboral</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </div>
                
                {newLicense.type === 'MEDICAL_LEAVE' && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Profesional (opcional)</label>
                      <input
                        type="text"
                        value={newLicense.doctorName}
                        onChange={(e) => setNewLicense({ ...newLicense, doctorName: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="Nombre del médico o matrícula"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contacto profesional (opcional)</label>
                      <input
                        type="text"
                        value={newLicense.doctorPhone}
                        onChange={(e) => setNewLicense({ ...newLicense, doctorPhone: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="Teléfono o consultorio"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
                    <input
                      aria-label="Fecha inicio"
                      type="date"
                      value={newLicense.startDate}
                      onChange={(e) => setNewLicense({ ...newLicense, startDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                    <input
                      aria-label="Fecha fin"
                      type="date"
                      value={newLicense.endDate}
                      onChange={(e) => setNewLicense({ ...newLicense, endDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Motivo (obligatorio)</label>
                  <textarea
                    aria-label="Motivo (obligatorio)"
                    value={newLicense.reason}
                    onChange={(e) => setNewLicense({ ...newLicense, reason: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={3}
                  />
                </div>

                {newLicense.type === 'MEDICAL_LEAVE' && (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-800">Certificado médico (opcional)</label>
                      <p className="text-xs text-gray-600 mt-0.5">
                        Podés pegar un enlace público (Drive, etc.) o adjuntar imagen o PDF (máx. 2,5 MB). Si cargás
                        archivo, tiene prioridad sobre el enlace.
                      </p>
                    </div>
                    <input
                      type="url"
                      value={newCertificateUrl}
                      onChange={(e) => setNewCertificateUrl(e.target.value)}
                      placeholder="https://…"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <div>
                      <input
                        type="file"
                        accept={medicalLeaveCertificateAcceptAttr()}
                        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-50"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const r = await readMedicalLeaveCertificateFile(file)
                          if (!r.ok) {
                            setCreateModalError(`❌ ${r.error}`)
                            e.target.value = ''
                            return
                          }
                          setNewLicense((prev) => ({
                            ...prev,
                            certificate: r.dataUrl,
                            certificateFileLabel: file.name,
                          }))
                          setNewCertificateUrl('')
                          setCreateModalError('')
                        }}
                      />
                      {newLicense.certificateFileLabel ? (
                        <p className="text-xs text-gray-600 mt-1">Archivo: {newLicense.certificateFileLabel}</p>
                      ) : null}
                    </div>
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas adicionales</label>
                  <textarea
                    aria-label="Notas adicionales"
                    value={newLicense.notes}
                    onChange={(e) => setNewLicense({ ...newLicense, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={2}
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setCreateModalError('')
                    setCreating(false)
                    setNewCertificateUrl('')
                    setNewLicense({
                      userId: '',
                      type: 'MEDICAL_LEAVE',
                      startDate: '',
                      endDate: '',
                      reason: '',
                      notes: '',
                      doctorName: '',
                      doctorPhone: '',
                      certificate: '',
                      certificateFileLabel: '',
                    })
                  }}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void createLicense()}
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
                  <p className="text-sm text-gray-900">{getLicenseStatusLabel(editing.status)}</p>
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">Profesional (opcional)</label>
                      <input
                        type="text"
                        value={editing.doctorName || ''}
                        onChange={(e) => setEditing({ ...editing, doctorName: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="Nombre o matrícula"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contacto del profesional (opcional)</label>
                      <input
                        type="text"
                        value={editing.doctorPhone || ''}
                        onChange={(e) => setEditing({ ...editing, doctorPhone: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        placeholder="Teléfono o consultorio"
                      />
                    </div>

                    <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 space-y-3">
                      <label className="block text-sm font-medium text-gray-800">Certificado médico (opcional)</label>
                      <p className="text-xs text-gray-600">
                        Enlace público (https) o archivo PNG, JPG, WEBP o PDF (máx. 2,5 MB).
                      </p>
                      {!editing.certificate?.startsWith('data:') && (
                        <input
                          type="url"
                          value={editing.certificate?.startsWith('http') ? editing.certificate : ''}
                          onChange={(e) => setEditing({ ...editing, certificate: e.target.value })}
                          placeholder="https://…"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      )}
                      {editing.certificate?.startsWith('data:') && (
                        <p className="text-sm text-gray-700">Certificado digital adjunto (imagen o PDF).</p>
                      )}
                      <input
                        type="file"
                        accept={medicalLeaveCertificateAcceptAttr()}
                        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-50"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const r = await readMedicalLeaveCertificateFile(file)
                          if (!r.ok) {
                            setMessage(`❌ ${r.error}`)
                            e.target.value = ''
                            return
                          }
                          setEditing((prev) => (prev ? { ...prev, certificate: r.dataUrl } : prev))
                          setMessage('')
                          e.target.value = ''
                        }}
                      />
                      {certificateHasValue(editing.certificate) && (
                        <button
                          type="button"
                          className="text-sm font-medium text-red-700 hover:text-red-900"
                          onClick={() => setEditing({ ...editing, certificate: '' })}
                        >
                          Quitar certificado
                        </button>
                      )}
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
                  type="button"
                  onClick={() => {
                    setEditModalError('')
                    setEditing(null)
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void updateLicense()}
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
