'use client'
import RoleGuard from '@/components/auth/RoleGuard'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import {
  buildMedicalLeavesQueryString,
  formatLicenseAdminUserDisplayName,
  getLicenseStatusBadgeClass,
  getLicenseStatusLabel,
  getLicenseTypeLabel,
} from '@/lib/admin/licenses-display'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { formatDateInUruguay } from '@/lib/forms/datetime-uy'
import { Calendar, FileText, Loader2, Plus, Search, Trash2 } from 'lucide-react'

type License = {
  id: string
  userId: string
  type: 'MEDICAL_LEAVE' | 'WORK_LEAVE' | 'OTHER'
  status: 'ACTIVE' | 'INACTIVE'
  startDate: string
  endDate: string
  reason: string
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

type NonWorkingDay = {
  id: string
  date: string
  type: 'HOLIDAY' | 'NON_WORKING_DAY'
  reason: string
  notes?: string | null
}

function datePartsToIsoUtcNoon(dateYmd: string): string {
  if (!dateYmd) return ''
  const day = dateYmd.includes('T') ? dateYmd.slice(0, 10) : dateYmd
  return new Date(`${day}T12:00:00.000Z`).toISOString()
}

function formatDateOnlyForDisplay(date: string): string {
  const day = date.includes('T') ? date.slice(0, 10) : date
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return date
  return `${match[3]}/${match[2]}/${match[1]}`
}

export default function LicensesPage() {
  const [activeSection, setActiveSection] = useState<'licenses' | 'non-working'>('licenses')
  const [licenses, setLicenses] = useState<License[]>([])
  const [nonWorkingDays, setNonWorkingDays] = useState<NonWorkingDay[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingNonWorkingDays, setLoadingNonWorkingDays] = useState(true)
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
    startDate: '',
    endDate: ''
  })

  const [newLicense, setNewLicense] = useState({
    userId: '',
    type: 'MEDICAL_LEAVE' as License['type'],
    startDate: '',
    endDate: '',
    reason: '',
    notes: '',
  })
  const currentYear = new Date().getFullYear()
  const [nonWorkingFilters, setNonWorkingFilters] = useState({
    from: `${currentYear}-01-01`,
    to: `${currentYear}-12-31`,
  })
  const [newNonWorkingDay, setNewNonWorkingDay] = useState({
    date: '',
    type: 'NON_WORKING_DAY' as NonWorkingDay['type'],
    reason: '',
    notes: '',
  })

  useEffect(() => {
    loadLicenses()
    loadNonWorkingDays()
    loadUsers()
  }, [])

  useEffect(() => {
    setSelectedLicenseIds([])
  }, [licenses])

  async function loadLicenses(override?: typeof filters) {
    setLoading(true)
    try {
      const qs = buildMedicalLeavesQueryString(override ?? filters)
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

  async function loadNonWorkingDays() {
    setLoadingNonWorkingDays(true)
    try {
      const qs = new URLSearchParams(nonWorkingFilters).toString()
      const data = await api<{ data: NonWorkingDay[] }>(`/non-working-days?${qs}`)
      setNonWorkingDays(data.data)
    } catch (error) {
      console.error('Error cargando días no laborables:', error)
    } finally {
      setLoadingNonWorkingDays(false)
    }
  }

  async function createNonWorkingDay() {
    setMessage('')
    if (!newNonWorkingDay.date || !newNonWorkingDay.reason.trim()) {
      setMessage('❌ Completá fecha y motivo para marcar el día no laborable.')
      return
    }
    try {
      await api('/non-working-days', {
        method: 'POST',
        body: JSON.stringify({
          date: newNonWorkingDay.date,
          type: newNonWorkingDay.type,
          reason: newNonWorkingDay.reason.trim(),
          notes: newNonWorkingDay.notes.trim() || undefined,
        }),
      })
      setMessage('✅ Día no laborable guardado correctamente')
      setNewNonWorkingDay({ date: '', type: 'NON_WORKING_DAY', reason: '', notes: '' })
      await loadNonWorkingDays()
    } catch (error: unknown) {
      setMessage(formatValidationErrorFromApi(error) || '❌ Error al guardar día no laborable')
    }
  }

  async function deleteNonWorkingDay(id: string) {
    if (!confirm('¿Eliminar este día no laborable?')) return
    try {
      await api(`/non-working-days/${id}`, { method: 'DELETE' })
      setMessage('✅ Día no laborable eliminado')
      await loadNonWorkingDays()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'No se pudo eliminar el día'}`)
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
    if (newLicense.type !== 'MEDICAL_LEAVE' && !newLicense.reason.trim()) {
      setCreateModalError('❌ Motivo: no puede estar vacío.')
      return
    }

    try {
      await api('/medical-leaves', {
        method: 'POST',
        body: JSON.stringify({
          userId: newLicense.userId,
          type: newLicense.type,
          startDate: datePartsToIsoUtcNoon(newLicense.startDate),
          endDate: datePartsToIsoUtcNoon(newLicense.endDate),
          reason: newLicense.type === 'MEDICAL_LEAVE' ? undefined : newLicense.reason,
          notes: newLicense.type === 'MEDICAL_LEAVE' ? undefined : newLicense.notes.trim() || undefined,
        }),
      })

      setCreateModalError('')
      setMessage('✅ Licencia creada correctamente')
      setCreating(false)
      setNewLicense({
        userId: '',
        type: 'MEDICAL_LEAVE',
        startDate: '',
        endDate: '',
        reason: '',
        notes: '',
      })
      await loadLicenses()
    } catch (error: unknown) {
      setCreateModalError(formatValidationErrorFromApi(error) || '❌ Error al crear licencia')
    }
  }

  async function updateLicense() {
    if (!editing) return

    setEditModalError('')
    if (editing.type !== 'MEDICAL_LEAVE' && !editing.reason?.trim()) {
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
          reason: editing.type === 'MEDICAL_LEAVE' ? undefined : editing.reason,
          notes: editing.type === 'MEDICAL_LEAVE' ? undefined : editing.notes,
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

  const activeLicenseFilterCount = Object.values(filters).filter(Boolean).length
  const licensesActiveCount = licenses.filter((l) => l.status === 'ACTIVE').length
  const licensesInactiveCount = licenses.filter((l) => l.status === 'INACTIVE').length
  const licensesMedicalCount = licenses.filter((l) => l.type === 'MEDICAL_LEAVE').length

  function renderLicensesRows() {
    if (loading) {
      return (
        <tr>
          <td colSpan={7} className="px-4 py-5 text-center text-gray-500">
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden />
              Cargando…
            </span>
          </td>
        </tr>
      )
    }

    if (licenses.length === 0) {
      return (
        <tr>
          <td colSpan={7} className="px-4 py-5 text-center text-gray-500">
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
          {formatDateInUruguay(license.startDate)} - {formatDateInUruguay(license.endDate)}
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
          <div className="flex gap-2">
            <button
              onClick={() => {
                setEditModalError('')
                setEditing(license)
              }}
              className="text-emerald-700 hover:text-emerald-900 font-medium"
            >
              Editar
            </button>
          </div>
        </td>
      </tr>
    ))
  }

  function renderLicenseCard(license: License) {
    return (
      <div key={license.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={selectedLicenseIds.includes(license.id)}
              onChange={() => toggleLicenseSelection(license.id)}
              disabled={license.status === 'INACTIVE'}
              aria-label={`Seleccionar licencia de ${license.user.name}`}
            />
            <div className="min-w-0">
              <div className="truncate font-medium text-gray-900">{license.user.name}</div>
              <div className="text-xs text-gray-500">{getLicenseTypeLabel(license.type)}</div>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${getLicenseStatusBadgeClass(license.status)}`}>
            {getLicenseStatusLabel(license.status)}
          </span>
        </div>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="shrink-0 text-gray-500">Período:</dt>
            <dd className="text-gray-900">
              {formatDateInUruguay(license.startDate)} - {formatDateInUruguay(license.endDate)}
            </dd>
          </div>
          {license.reason ? (
            <div className="flex gap-2">
              <dt className="shrink-0 text-gray-500">Motivo:</dt>
              <dd className="break-words text-gray-900">{license.reason}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
          <button
            type="button"
            onClick={() => {
              setEditModalError('')
              setEditing(license)
            }}
            className="btn-secondary text-sm"
          >
            Editar
          </button>
        </div>
      </div>
    )
  }

  function renderNonWorkingDayCard(day: NonWorkingDay) {
    return (
      <div key={day.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-gray-900">{formatDateOnlyForDisplay(day.date)}</div>
            <div className="text-xs text-gray-500">{day.type === 'HOLIDAY' ? 'Feriado' : 'No laborable'}</div>
          </div>
          <button
            type="button"
            onClick={() => void deleteNonWorkingDay(day.id)}
            className="shrink-0 text-sm font-medium text-red-700 hover:text-red-900"
          >
            Eliminar
          </button>
        </div>
        <div className="mt-2 text-sm text-gray-900">{day.reason}</div>
        {day.notes ? <div className="mt-1 text-sm text-gray-600">{day.notes}</div> : null}
      </div>
    )
  }

  return (
    <RoleGuard permission="licenses.read" permissionScope="all">
      <main className="responsive-page max-w-[1600px] space-y-5">
        {/* Header alineado a otros módulos admin */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <FileText className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Gestión de licencias</h1>
              <p className="mt-1 max-w-2xl text-gray-600">
                Registro centralizado por la dirección o administración. El personal solo consulta sus licencias en su
                panel. Las licencias activas se reflejan en la justificación de inasistencias cuando corresponde.
              </p>
            </div>
          </div>
          {activeSection === 'licenses' ? (
            <div className="flex flex-col items-end gap-3 shrink-0">
              <div className="text-right">
                <div className="text-2xl font-bold text-emerald-600">{loading ? '—' : licenses.length}</div>
                <div className="text-sm text-gray-600">registros listados</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreateModalError('')
                  setCreating(true)
                }}
                className="btn-primary inline-flex items-center gap-2"
              >
                <Plus className="h-4 w-4 shrink-0" aria-hidden />
                Nueva Licencia
              </button>
            </div>
          ) : null}
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveSection('licenses')}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              activeSection === 'licenses' ? 'bg-emerald-600 text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            Licencias
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('non-working')}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              activeSection === 'non-working' ? 'bg-emerald-600 text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            Días no laborables
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

        {activeSection === 'non-working' && (
          <section className="space-y-4">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="mb-4 border-b border-gray-100 pb-3 text-lg font-semibold text-gray-900">
                Marcar feriado o día no laborable
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Fecha</label>
                  <input
                    type="date"
                    value={newNonWorkingDay.date}
                    onChange={(e) => setNewNonWorkingDay({ ...newNonWorkingDay, date: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Tipo</label>
                  <select
                    value={newNonWorkingDay.type}
                    onChange={(e) => setNewNonWorkingDay({ ...newNonWorkingDay, type: e.target.value as NonWorkingDay['type'] })}
                    className="select-field"
                  >
                    <option value="NON_WORKING_DAY">Día no laborable</option>
                    <option value="HOLIDAY">Feriado</option>
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-gray-700">Motivo</label>
                  <input
                    type="text"
                    value={newNonWorkingDay.reason}
                    onChange={(e) => setNewNonWorkingDay({ ...newNonWorkingDay, reason: e.target.value })}
                    className="input-field"
                    placeholder="Ej: Feriado nacional"
                  />
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <label className="mb-2 block text-sm font-medium text-gray-700">Notas</label>
                  <textarea
                    value={newNonWorkingDay.notes}
                    onChange={(e) => setNewNonWorkingDay({ ...newNonWorkingDay, notes: e.target.value })}
                    className="input-field"
                    rows={2}
                  />
                </div>
                <div className="flex items-end">
                  <button type="button" onClick={() => void createNonWorkingDay()} className="btn-primary w-full sm:w-auto">
                    Guardar día
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4 sm:px-5">
                  <h2 className="text-lg font-semibold text-gray-900">Calendario no laborable</h2>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Desde</label>
                      <input
                        type="date"
                        value={nonWorkingFilters.from}
                        onChange={(e) => setNonWorkingFilters({ ...nonWorkingFilters, from: e.target.value })}
                        className="input-field h-10 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Hasta</label>
                      <input
                        type="date"
                        value={nonWorkingFilters.to}
                        onChange={(e) => setNonWorkingFilters({ ...nonWorkingFilters, to: e.target.value })}
                        className="input-field h-10 text-sm"
                      />
                    </div>
                    <button type="button" onClick={() => void loadNonWorkingDays()} className="btn-secondary h-10">
                      Buscar
                    </button>
                  </div>
              </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[720px] table-fixed divide-y divide-gray-200">
                  <colgroup>
                    <col className="w-[14%]" />
                    <col className="w-[16%]" />
                    <col className="w-[30%]" />
                    <col className="w-[28%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase text-gray-500">Fecha</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase text-gray-500">Tipo</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase text-gray-500">Motivo</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase text-gray-500">Notas</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase text-gray-500">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {loadingNonWorkingDays ? (
                      <tr><td colSpan={5} className="px-4 py-5 text-center text-gray-500">Cargando…</td></tr>
                    ) : nonWorkingDays.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-5 text-center text-gray-500">No hay días marcados</td></tr>
                    ) : (
                      nonWorkingDays.map((day) => (
                        <tr key={day.id}>
                          <td className="px-6 py-4 text-sm text-gray-900">{formatDateOnlyForDisplay(day.date)}</td>
                          <td className="px-6 py-4 text-sm text-gray-900">{day.type === 'HOLIDAY' ? 'Feriado' : 'No laborable'}</td>
                          <td className="px-6 py-4 text-sm text-gray-900">{day.reason}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{day.notes || '-'}</td>
                          <td className="px-6 py-4 text-sm">
                            <button type="button" onClick={() => void deleteNonWorkingDay(day.id)} className="font-medium text-red-700 hover:text-red-900">
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-4 sm:hidden">
                {loadingNonWorkingDays ? (
                  <div className="py-5 text-center text-sm text-gray-500">Cargando…</div>
                ) : nonWorkingDays.length === 0 ? (
                  <div className="py-5 text-center text-sm text-gray-500">No hay días marcados</div>
                ) : (
                  nonWorkingDays.map(renderNonWorkingDayCard)
                )}
              </div>
            </div>
          </section>
        )}

        {activeSection === 'licenses' && (
          <section className="space-y-4">
        {/* Filtros (mismo patrón que Control y seguimiento del personal) */}
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 border-b border-gray-100 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                  <Search className="h-4 w-4 text-emerald-600" aria-hidden />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Filtros de Búsqueda</h2>
              </div>
              <div className="flex items-center gap-2">
                {activeLicenseFilterCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-100 px-1.5 text-xs font-semibold text-emerald-700">
                      {activeLicenseFilterCount}
                    </span>
                    {activeLicenseFilterCount === 1 ? 'filtro activo' : 'filtros activos'}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    const cleared = { userId: '', type: '', status: '', startDate: '', endDate: '' }
                    setFilters(cleared)
                    void loadLicenses(cleared)
                  }}
                  className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                >
                  <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
                  Limpiar
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor="license-filter-from"
                className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700"
              >
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Desde (período)
              </label>
              <input
                id="license-filter-from"
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label
                htmlFor="license-filter-to"
                className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700"
              >
                <Calendar className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Hasta (período)
              </label>
              <input
                id="license-filter-to"
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="input-field"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Usuario</label>
              <select
                value={filters.userId}
                onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
                className="select-field"
              >
                <option value="">Todos</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Tipo</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                className="select-field"
              >
                <option value="">Todos</option>
                <option value="MEDICAL_LEAVE">Licencia Médica</option>
                <option value="WORK_LEAVE">Licencia Laboral</option>
                <option value="OTHER">Otro</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Estado</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="select-field"
              >
                <option value="">Todos</option>
                <option value="ACTIVE">Activa</option>
                <option value="INACTIVE">Inactiva</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <button type="button" onClick={() => void loadLicenses()} className="btn-primary">
              Aplicar filtros
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
            <div className="text-xs text-gray-500">Totales listados</div>
            <div className="text-xl font-bold text-emerald-600">{loading ? '—' : licenses.length}</div>
          </div>
          <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
            <div className="text-xs text-gray-500">Activas</div>
            <div className="text-xl font-bold text-emerald-600">{loading ? '—' : licensesActiveCount}</div>
          </div>
          <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
            <div className="text-xs text-gray-500">Inactivas</div>
            <div className="text-xl font-bold text-red-600">{loading ? '—' : licensesInactiveCount}</div>
          </div>
          <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
            <div className="text-xs text-gray-500">Lic. médicas</div>
            <div className="text-xl font-bold text-slate-800">{loading ? '—' : licensesMedicalCount}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-gray-100 p-4 md:flex-row md:items-center md:justify-between">
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
                className="btn-secondary inline-flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingSelected ? 'Eliminando…' : 'Eliminar seleccionadas'}
              </button>
            </div>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[980px] table-fixed divide-y divide-gray-200">
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[20%]" />
                <col className="w-[14%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[30%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">
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
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Usuario</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Período</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Motivo</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {renderLicensesRows()}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 p-4 sm:hidden">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-5 text-sm text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden />
                Cargando…
              </div>
            ) : licenses.length === 0 ? (
              <div className="py-5 text-center text-sm text-gray-500">No hay licencias registradas</div>
            ) : (
              licenses.map(renderLicenseCard)
            )}
          </div>
        </div>
          </section>
        )}

        {/* Modal para crear licencia */}
        {creating && (
          <div className="responsive-modal backdrop-blur-sm">
            <div className="responsive-modal-panel max-w-2xl">
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
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                    onChange={(e) => setNewLicense({ ...newLicense, type: e.target.value as License['type'] })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="MEDICAL_LEAVE">Licencia Médica</option>
                    <option value="WORK_LEAVE">Licencia Laboral</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
                    <input
                      aria-label="Fecha inicio"
                      type="date"
                      value={newLicense.startDate}
                      onChange={(e) => setNewLicense({ ...newLicense, startDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                    <input
                      aria-label="Fecha fin"
                      type="date"
                      value={newLicense.endDate}
                      onChange={(e) => setNewLicense({ ...newLicense, endDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                
                {newLicense.type === 'MEDICAL_LEAVE' ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-gray-700">
                    Para licencias médicas, EduTrack solo registra el período y la constancia administrativa de que la
                    licencia fue presentada. No se cargan certificados, diagnósticos, datos del profesional ni notas
                    clínicas.
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Motivo (obligatorio)</label>
                    <textarea
                      aria-label="Motivo (obligatorio)"
                      value={newLicense.reason}
                      onChange={(e) => setNewLicense({ ...newLicense, reason: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      rows={3}
                    />
                  </div>
                )}
                 
                {newLicense.type !== 'MEDICAL_LEAVE' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notas adicionales</label>
                    <textarea
                      aria-label="Notas adicionales"
                      value={newLicense.notes}
                      onChange={(e) => setNewLicense({ ...newLicense, notes: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      rows={2}
                    />
                  </div>
                )}
              </div>
              
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreateModalError('')
                    setCreating(false)
                    setNewLicense({
                      userId: '',
                      type: 'MEDICAL_LEAVE',
                      startDate: '',
                      endDate: '',
                      reason: '',
                      notes: '',
                    })
                  }}
                  className="btn-secondary"
                >
                  Cancelar
                </button>
                <button type="button" onClick={() => void createLicense()} className="btn-primary">
                  Crear Licencia
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal para ver detalles */}
        {editing && (
          <div className="responsive-modal backdrop-blur-sm">
            <div className="responsive-modal-panel max-w-2xl">
              <h3 className="mb-4 text-lg font-semibold">Editar Licencia</h3>

              {editModalError ? (
                <div
                  className={`mb-4 whitespace-pre-line rounded border p-3 text-sm ${getAdminFlashMessageClass(editModalError)}`}
                  role="alert"
                >
                  {editModalError}
                </div>
              ) : null}

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
                    <p className="text-sm text-gray-900">{editing.user.name}</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                    <select
                      value={editing.type}
                      onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="MEDICAL_LEAVE">Licencia Médica</option>
                      <option value="WORK_LEAVE">Licencia Laboral</option>
                      <option value="OTHER">Otro</option>
                    </select>
                  </div>
                </div>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
                    <input
                      type="date"
                      value={editing.startDate.split('T')[0]}
                      onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                    <input
                      type="date"
                      value={editing.endDate.split('T')[0]}
                      onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <p className="text-sm text-gray-900">{getLicenseStatusLabel(editing.status)}</p>
                </div>
                
                {editing.type === 'MEDICAL_LEAVE' ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-gray-700">
                    Para licencias médicas se conserva solo la constancia administrativa de presentación y el período.
                    Al guardar, se descartan notas o motivos clínicos.
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
                    <textarea
                      value={editing.reason}
                      onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      rows={3}
                    />
                  </div>
                )}
                
                {editing.type !== 'MEDICAL_LEAVE' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                    <textarea
                      value={editing.notes || ''}
                      onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                      className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      rows={3}
                    />
                  </div>
                )}
                
                {editing.approvedBy && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Aprobado por</label>
                    <p className="text-sm text-gray-900">{editing.approvedBy}</p>
                  </div>
                )}
                
                {editing.approvedAt && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de aprobación</label>
                    <p className="text-sm text-gray-900">{formatDateInUruguay(editing.approvedAt)}</p>
                  </div>
                )}
              </div>
              
              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditModalError('')
                    setEditing(null)
                  }}
                  className="btn-secondary"
                >
                  Cancelar
                </button>
                <button type="button" onClick={() => void updateLicense()} className="btn-primary">
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
