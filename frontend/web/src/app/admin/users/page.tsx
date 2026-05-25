'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import BiometricLinkSection from '@/components/profile/BiometricLinkSection'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import {
  ADMIN_USERS_PAGE_SIZE,
  buildAdminUserEditChanges,
  buildAdminUsersQueryParams,
  cloneAdminUser,
  displayUserName,
  formatYmdDate,
  getActiveBadgeClass,
  getActiveLabel,
  getAdminUserSaveErrorMessage,
  getApprovalBadgeClass,
  getApprovalLabel,
  getLockBadgeClass,
  getLockLabel,
  getVerificationBadgeClass,
  getVerificationLabel,
  isAccountLocked,
  type AdminUserRow,
  type AdminUsersListFilters,
  type TriState,
} from '@/lib/admin/users-display'
import { ChevronLeft, ChevronRight, Fingerprint, Loader2, Search, Users } from 'lucide-react'

type OrgRoleRow = { code: string; label: string; active: boolean }

function triStateOptions(label: string): { value: TriState; hint: string }[] {
  return [
    { value: '', hint: `${label}: cualquiera` },
    { value: 'true', hint: `${label}: sí` },
    { value: 'false', hint: `${label}: no` },
  ]
}

const defaultFilters = (): AdminUsersListFilters => ({
  q: '',
  role: 'ALL',
  approved: '',
  active: '',
  verified: '',
  locked: '',
  page: 1,
})

export default function AdminUsersPage() {
  const [data, setData] = useState<{ total: number; page: number; pageSize: number; data: AdminUserRow[] }>({
    total: 0,
    page: 1,
    pageSize: ADMIN_USERS_PAGE_SIZE,
    data: [],
  })
  const [filters, setFilters] = useState<AdminUsersListFilters>(defaultFilters)
  const [draftFilters, setDraftFilters] = useState<AdminUsersListFilters>(defaultFilters)
  const [orgRoles, setOrgRoles] = useState<OrgRoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<AdminUserRow | null>(null)
  const [editOrig, setEditOrig] = useState<AdminUserRow | null>(null)
  const [biometricUser, setBiometricUser] = useState<AdminUserRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async (f: AdminUsersListFilters) => {
    setLoading(true)
    try {
      const qs = buildAdminUsersQueryParams(f)
      const r = await api<{ total: number; page?: number; pageSize?: number; data: AdminUserRow[] }>(`/admin/users?${qs}`)
      setData({
        total: r.total ?? 0,
        page: r.page ?? f.page,
        pageSize: r.pageSize ?? ADMIN_USERS_PAGE_SIZE,
        data: Array.isArray(r.data) ? r.data : [],
      })
      setFilters(f)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const roles = await api<OrgRoleRow[]>('/admin/org-roles')
        setOrgRoles(roles.filter((r) => r.active))
      } catch {
        setOrgRoles([])
      }
      const initial = defaultFilters()
      setDraftFilters(initial)
      await load(initial)
    })()
  }, [load])

  const roleChoicesFromApi = orgRoles.filter((r) => r.code !== 'ADMIN')
  /** Si el backend aún no devolvió roles, no dejamos selects vacíos */
  const roleChoices =
    roleChoicesFromApi.length > 0
      ? roleChoicesFromApi
      : [
          { code: 'TEACHER', label: 'Docente', active: true },
          { code: 'STAFF', label: 'Administrativo', active: true },
        ]

  function applyFilters() {
    void load({ ...draftFilters, page: 1 })
  }

  function resetDraftFilters() {
    const cleared = defaultFilters()
    setDraftFilters(cleared)
    void load(cleared)
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const rangeStart = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1
  const rangeEnd = Math.min(data.page * data.pageSize, data.total)

  function openEdit(u: AdminUserRow) {
    setEdit(cloneAdminUser(u))
    setEditOrig(cloneAdminUser(u))
  }
  function closeEdit() {
    setEdit(null)
    setEditOrig(null)
    setMsg('')
  }

  async function saveEdit() {
    if (!edit) return
    const changes = buildAdminUserEditChanges(editOrig, edit)
    const proceed = confirm(
      changes.length ? `Confirmar cambios:\n - ${changes.join('\n - ')}` : 'No hay cambios. ¿Guardar igualmente?',
    )
    if (!proceed) return

    let docPayload: string | null = null
    const raw = edit.nationalIdDocumentExpiresAt
    if (raw != null && String(raw).trim() !== '') {
      const s = String(raw).trim()
      docPayload = s.length <= 12 && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : formatYmdDate(s)
      if (docPayload === '—') docPayload = null
    }

    setSaving(true)
    setMsg('')
    try {
      await api(`/admin/users/${edit.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          role: edit.role,
          username: edit.username,
          nationalId: edit.nationalId,
          nationalIdDocumentExpiresAt: docPayload,
          firstName: edit.firstName,
          lastName: edit.lastName,
          isApproved: edit.isApproved,
          isActive: edit.isActive,
        }),
      })
      await load(filters)
      closeEdit()
    } catch (e: unknown) {
      setMsg(getAdminUserSaveErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function toggleLock(u: AdminUserRow) {
    const lock = !isAccountLocked(u.lockUntil)
    if (!confirm(lock ? '¿Bloquear este usuario 15 minutos?' : '¿Desbloquear usuario?')) return
    try {
      await api(`/admin/users/${u.id}/lock?lock=${lock}`, { method: 'PUT' })
      await load(filters)
    } catch (e: unknown) {
      alert(getAdminUserSaveErrorMessage(e))
    }
  }

  async function toggleApproval(u: AdminUserRow) {
    const next = !u.isApproved
    if (!confirm(next ? '¿Aprobar usuario?' : '¿Marcar como pendiente de aprobación?')) return
    try {
      await api(`/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ isApproved: next }) })
      await load(filters)
    } catch (e: unknown) {
      alert(getAdminUserSaveErrorMessage(e))
    }
  }

  async function toggleActive(u: AdminUserRow) {
    const next = !u.isActive
    if (!confirm(next ? '¿Dar de alta al usuario?' : '¿Dar de baja al usuario?')) return
    try {
      await api(`/admin/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ isActive: next }) })
      await load(filters)
    } catch (e: unknown) {
      alert(getAdminUserSaveErrorMessage(e))
    }
  }

  function renderUserRow(u: AdminUserRow) {
    if (u.role === 'ADMIN') return null
    const biometricLabel = u.biometricLinked ? 'Huella vinculada' : 'Vincular huella'
    const biometricButtonClass = u.biometricLinked
      ? 'inline-grid h-9 w-9 place-items-center rounded-lg border border-emerald-500 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400'
      : 'inline-grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-400'

    return (
      <tr key={u.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/80">
        <td className="px-3 py-3 align-middle font-mono text-xs text-slate-700">{u.username || '—'}</td>
        <td className="px-3 py-3 align-middle">
          <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
            {u.role}
          </span>
        </td>
        <td className="px-3 py-3 align-middle text-sm">
          <div className="font-medium text-slate-900">{displayUserName(u)}</div>
          <div className="truncate text-xs text-slate-500 max-w-[14rem]" title={u.email}>
            {u.email}
          </div>
        </td>
        <td className="px-3 py-3 align-middle">
          <span className={getVerificationBadgeClass(u.emailVerifiedAt)}>{getVerificationLabel(u.emailVerifiedAt)}</span>
        </td>
        <td className="px-3 py-3 align-middle">
          <span className={getApprovalBadgeClass(u.isApproved)}>{getApprovalLabel(u.isApproved)}</span>
        </td>
        <td className="px-3 py-3 align-middle">
          <span className={getActiveBadgeClass(u.isActive)}>{getActiveLabel(u.isActive)}</span>
        </td>
        <td className="px-3 py-3 align-middle">
          <span className={getLockBadgeClass(u.lockUntil)} title={getLockLabel(u.lockUntil)}>
            {isAccountLocked(u.lockUntil) ? 'Bloqueado' : 'Libre'}
          </span>
        </td>
        <td className="px-3 py-3 align-middle text-right">
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={() => toggleApproval(u)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              title={u.isApproved ? 'Volver a pendiente' : 'Aprobar'}
            >
              {u.isApproved ? 'Pendiente' : 'Aprobar'}
            </button>
            <button
              type="button"
              onClick={() => toggleActive(u)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              title={u.isActive ? 'Dar de baja' : 'Dar de alta'}
            >
              {u.isActive ? 'Dar baja' : 'Dar alta'}
            </button>
            <button
              type="button"
              onClick={() => setBiometricUser(u)}
              className={biometricButtonClass}
              aria-label={biometricLabel}
              title={biometricLabel}
            >
              <Fingerprint className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => openEdit(u)}
              className="inline-grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              aria-label="Editar usuario"
              title="Editar datos del usuario"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M13.586 3.586a2 2 0 0 1 2.828 2.828l-9.192 9.192a2 2 0 0 1-.878.505l-3.06.785a.5 .5 0 0 1-.606-.606l.785-3.06a2 2 0 0 1 .505-.878l9.192-9.192Z" />
                <path d="M12.172 4.999 15 7.828" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => toggleLock(u)}
              className="inline-grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              aria-label={isAccountLocked(u.lockUntil) ? 'Desbloquear' : 'Bloquear 15 min'}
              title={isAccountLocked(u.lockUntil) ? 'Desbloquear' : 'Bloquear 15 min'}
            >
              {isAccountLocked(u.lockUntil) ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M5 8a5 5 0 1 1 10 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h7V8a3 3 0 0 0-6 0H5Z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10 2a5 5 0 0 1 5 5v1h-2V7a3 3 0 1 0-6 0v1H5V7a5 5 0 0 1 5-5Z" />
                  <path d="M4 9h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
                </svg>
              )}
            </button>
          </div>
        </td>
      </tr>
    )
  }

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40'

  return (
    <RoleGuard permission="users.read" permissionScope="all">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <Users className="h-6 w-6 text-emerald-700" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Usuarios</h1>
              <p className="mt-1 text-sm text-slate-600">
                Alta, aprobación, roles y cuenta. No incluye cuentas de administrador de plataforma.
              </p>
            </div>
          </div>
        </div>

        <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Filtros</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-2">
              <label htmlFor="filter-q" className="mb-1 block text-xs font-medium text-slate-600">
                Búsqueda
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  id="filter-q"
                  value={draftFilters.q}
                  onChange={(e) => setDraftFilters({ ...draftFilters, q: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyFilters()
                  }}
                  placeholder="Email, usuario, nombre o apellido"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/80 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                />
              </div>
            </div>
            <div>
              <label htmlFor="filter-role" className="mb-1 block text-xs font-medium text-slate-600">
                Rol
              </label>
              <select
                id="filter-role"
                value={draftFilters.role}
                onChange={(e) => setDraftFilters({ ...draftFilters, role: e.target.value })}
                className={`w-full ${selectCls}`}
              >
                <option value="ALL">Todos los roles</option>
                {roleChoices.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label} ({r.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-approved" className="mb-1 block text-xs font-medium text-slate-600">
                Aprobación
              </label>
              <select
                id="filter-approved"
                value={draftFilters.approved}
                onChange={(e) => setDraftFilters({ ...draftFilters, approved: e.target.value as TriState })}
                className={`w-full ${selectCls}`}
              >
                {triStateOptions('Aprobación').map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.value === '' ? 'Cualquiera' : o.value === 'true' ? 'Solo aprobados' : 'Solo pendientes'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-active" className="mb-1 block text-xs font-medium text-slate-600">
                Alta / baja
              </label>
              <select
                id="filter-active"
                value={draftFilters.active}
                onChange={(e) => setDraftFilters({ ...draftFilters, active: e.target.value as TriState })}
                className={`w-full ${selectCls}`}
              >
                <option value="">Cualquiera</option>
                <option value="true">Solo alta</option>
                <option value="false">Solo baja</option>
              </select>
            </div>
            <div>
              <label htmlFor="filter-verified" className="mb-1 block text-xs font-medium text-slate-600">
                Email verificado
              </label>
              <select
                id="filter-verified"
                value={draftFilters.verified}
                onChange={(e) => setDraftFilters({ ...draftFilters, verified: e.target.value as TriState })}
                className={`w-full ${selectCls}`}
              >
                <option value="">Cualquiera</option>
                <option value="true">Verificado</option>
                <option value="false">Sin verificar</option>
              </select>
            </div>
            <div>
              <label htmlFor="filter-locked" className="mb-1 block text-xs font-medium text-slate-600">
                Bloqueo temporal
              </label>
              <select
                id="filter-locked"
                value={draftFilters.locked}
                onChange={(e) => setDraftFilters({ ...draftFilters, locked: e.target.value as TriState })}
                className={`w-full ${selectCls}`}
              >
                <option value="">Cualquiera</option>
                <option value="true">Bloqueado ahora</option>
                <option value="false">Sin bloqueo activo</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              Aplicar filtros
            </button>
            <button
              type="button"
              onClick={resetDraftFilters}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              Limpiar
            </button>
          </div>
        </section>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden />
                Cargando…
              </span>
            ) : data.total === 0 ? (
              'Sin resultados con los filtros actuales.'
            ) : (
              <>
                Mostrando <strong className="font-semibold text-slate-900">{rangeStart}</strong> –
                <strong className="font-semibold text-slate-900">{rangeEnd}</strong> de{' '}
                <strong className="font-semibold text-slate-900">{data.total}</strong>
              </>
            )}
          </p>
          {data.total > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loading || data.page <= 1}
                onClick={() => void load({ ...filters, page: filters.page - 1 })}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden /> Anterior
              </button>
              <span className="text-sm text-slate-600">
                Página {data.page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={loading || data.page >= totalPages}
                onClick={() => void load({ ...filters, page: filters.page + 1 })}
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Siguiente <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-3 py-3">Usuario</th>
                  <th className="whitespace-nowrap px-3 py-3">Rol</th>
                  <th className="min-w-[12rem] px-3 py-3">Persona</th>
                  <th className="whitespace-nowrap px-3 py-3">Verificado</th>
                  <th className="whitespace-nowrap px-3 py-3">Aprobación</th>
                  <th className="whitespace-nowrap px-3 py-3">Estado</th>
                  <th className="whitespace-nowrap px-3 py-3">Acceso</th>
                  <th className="w-px whitespace-nowrap px-3 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!loading &&
                  (data.data ?? []).map(renderUserRow).filter(Boolean)}
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-500">
                      <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-emerald-600" aria-hidden />
                      Cargando usuarios…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {edit && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-[1px]">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900">Editar usuario</h2>
              <p className="mt-1 text-xs text-slate-500">{edit.email}</p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Usuario (login)</label>
                  <input
                    value={edit.username ?? ''}
                    onChange={(e) => setEdit({ ...edit, username: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    minLength={3}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Nombre</label>
                  <input
                    value={edit.firstName ?? ''}
                    onChange={(e) => setEdit({ ...edit, firstName: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Apellido</label>
                  <input
                    value={edit.lastName ?? ''}
                    onChange={(e) => setEdit({ ...edit, lastName: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Rol</label>
                  {edit.role === 'ADMIN' ? (
                    <input value="ADMIN" disabled className="w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
                  ) : (
                    <select
                      value={edit.role}
                      onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    >
                      {!roleChoices.some((r) => r.code === edit.role) && edit.role !== 'ADMIN' ? (
                        <option value={edit.role}>{edit.role}</option>
                      ) : null}
                      {roleChoices.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label} ({r.code})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Cédula</label>
                  <input
                    value={edit.nationalId ?? ''}
                    onChange={(e) => setEdit({ ...edit, nationalId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">Vencimiento documento (CI)</label>
                  <input
                    type="date"
                    value={(() => {
                      const x = edit.nationalIdDocumentExpiresAt
                      if (!x) return ''
                      const s = String(x).trim()
                      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : formatYmdDate(s) === '—' ? '' : formatYmdDate(s)
                    })()}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        nationalIdDocumentExpiresAt: e.target.value || null,
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                  />
                  <p className="mt-1 text-xs text-slate-400">Dejar vacío para no definir fecha de vencimiento en este paso.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Aprobación</label>
                  <select
                    value={edit.isApproved ? 'true' : 'false'}
                    onChange={(e) => setEdit({ ...edit, isApproved: e.target.value === 'true' })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="false">Pendiente</option>
                    <option value="true">Aprobado</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Estado cuenta</label>
                  <select
                    value={edit.isActive ? 'true' : 'false'}
                    onChange={(e) => setEdit({ ...edit, isActive: e.target.value === 'true' })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="true">Alta</option>
                    <option value="false">Baja</option>
                  </select>
                </div>
              </div>
              {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
              <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        )}

        {biometricUser && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4 backdrop-blur-[1px]">
            <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Vincular huella</h2>
                  <p className="mt-1 text-xs text-slate-500">{displayUserName(biometricUser)} · {biometricUser.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setBiometricUser(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cerrar
                </button>
              </div>
              <BiometricLinkSection
                targetUserId={biometricUser.id}
                targetUserName={displayUserName(biometricUser)}
                onChanged={() => void load(filters)}
              />
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
