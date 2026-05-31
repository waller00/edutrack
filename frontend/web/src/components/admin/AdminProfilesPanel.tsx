'use client'

import { api } from '@/lib/api/client'
import {
  Check,
  ChevronDown,
  Eye,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type PermissionScope = 'own' | 'all'
type PermissionSource = 'system' | 'custom'

type PermissionCatalogItem = {
  id: string
  module: string
  action: string
  label?: string
  source?: PermissionSource
}

type ProfilePermission = PermissionCatalogItem & {
  label: string
  enabled: boolean
  scope: PermissionScope
}

type Profile = {
  role: string
  label: string
  permissions: ProfilePermission[]
}

type ProfilesResponse = {
  roles: Profile[]
  permissionCatalog: PermissionCatalogItem[]
}

type DraftPermission = {
  id: string
  enabled: boolean
  scope: PermissionScope
  label: string
}

type NewProfileForm = {
  code: string
  label: string
  permissions: Record<string, DraftPermission>
}

const EMPTY_NEW_PROFILE: NewProfileForm = {
  code: '',
  label: '',
  permissions: {},
}

function groupCatalog(permissions: PermissionCatalogItem[]) {
  return permissions.reduce<Record<string, PermissionCatalogItem[]>>((acc, permission) => {
    acc[permission.module] = acc[permission.module] || []
    acc[permission.module].push(permission)
    return acc
  }, {})
}

function scopeLabel(scope: PermissionScope) {
  return scope === 'all' ? 'Todos' : 'Propios'
}

function defaultLabel(permission: PermissionCatalogItem) {
  return permission.label || `${permission.module}: ${permission.action}`
}

function trimRepeatedChar(value: string, char: string) {
  let start = 0
  let end = value.length
  while (start < end && value[start] === char) start += 1
  while (end > start && value[end - 1] === char) end -= 1
  return value.slice(start, end)
}

function slugRoleCode(value: string) {
  const normalized = value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
  return trimRepeatedChar(normalized, '_').toUpperCase()
}

function buildDraft(profile: Profile, catalog: PermissionCatalogItem[]): Record<string, DraftPermission> {
  const assigned = new Map(profile.permissions.map((permission) => [permission.id, permission]))
  return Object.fromEntries(
    catalog.map((permission) => {
      const current = assigned.get(permission.id)
      return [
        permission.id,
        {
          id: permission.id,
          enabled: current?.enabled ?? false,
          scope: current?.scope ?? 'own',
          label: current?.label ?? defaultLabel(permission),
        },
      ]
    }),
  )
}

export default function AdminProfilesPanel({ compact = false }: { compact?: boolean } = {}) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, Record<string, DraftPermission>>>({})
  const [selectedRole, setSelectedRole] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [newProfileOpen, setNewProfileOpen] = useState(false)
  const [newProfile, setNewProfile] = useState<NewProfileForm>(EMPTY_NEW_PROFILE)
  const [savingRole, setSavingRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  function applyProfiles(data: ProfilesResponse) {
    setProfiles(data.roles)
    setCatalog(data.permissionCatalog)
    setDrafts(Object.fromEntries(data.roles.map((profile) => [profile.role, buildDraft(profile, data.permissionCatalog)])))
    setSelectedRole((current) => current || data.roles[0]?.role || '')
    setNewProfile((current) => ({
      ...current,
      permissions: buildEmptyProfileDraft(data.permissionCatalog),
    }))
  }

  function buildEmptyProfileDraft(items = catalog) {
    return Object.fromEntries(
      items.map((permission) => [
        permission.id,
        {
          id: permission.id,
          enabled: false,
          scope: 'own' as PermissionScope,
          label: defaultLabel(permission),
        },
      ]),
    )
  }

  async function loadProfiles() {
    setLoading(true)
    setMessage('')
    try {
      applyProfiles(await api<ProfilesResponse>('/admin/profiles'))
    } catch (error: any) {
      setMessage(error?.message || 'No se pudieron cargar los perfiles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  const groupedCatalog = useMemo(() => groupCatalog(catalog), [catalog])

  const totals = useMemo(() => {
    const assigned = profiles.reduce((sum, profile) => sum + profile.permissions.filter((permission) => permission.enabled).length, 0)
    return { profiles: profiles.length, assigned, catalog: catalog.length }
  }, [catalog.length, profiles])

  function updateDraft(role: string, permissionId: string, patch: Partial<DraftPermission>) {
    setDrafts((current) => ({
      ...current,
      [role]: {
        ...current[role],
        [permissionId]: { ...current[role][permissionId], ...patch },
      },
    }))
  }

  async function saveProfile(role: string) {
    setSavingRole(role)
    setMessage('')
    try {
      const permissions = Object.values(drafts[role] ?? {})
      const data = await api<ProfilesResponse>(`/admin/profiles/${role}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions }),
      })
      applyProfiles(data)
      setMessage('Perfil guardado.')
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo guardar el perfil')
    } finally {
      setSavingRole('')
    }
  }

  async function createProfile() {
    const code = slugRoleCode(newProfile.code || newProfile.label)
    if (!code || !newProfile.label.trim()) {
      setMessage('Completá el nombre y el código del perfil.')
      return
    }
    setSavingRole('new')
    setMessage('')
    try {
      const data = await api<ProfilesResponse>('/admin/profiles', {
        method: 'POST',
        body: JSON.stringify({
          code,
          label: newProfile.label.trim(),
          permissions: Object.values(newProfile.permissions),
        }),
      })
      applyProfiles(data)
      setNewProfile({ ...EMPTY_NEW_PROFILE, permissions: buildEmptyProfileDraft(data.permissionCatalog) })
      setNewProfileOpen(false)
      setSelectedRole(code)
      setMessage('Perfil creado.')
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo crear el perfil')
    } finally {
      setSavingRole('')
    }
  }

  function renderPermissionRows(
    draft: Record<string, DraftPermission>,
    onChange: (permissionId: string, patch: Partial<DraftPermission>) => void,
  ) {
    return (
      <div className="space-y-4">
        {Object.entries(groupedCatalog).map(([module, permissions]) => (
          <section key={module} className="rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 border-b border-gray-100 bg-slate-50 px-4 py-3">
              <SlidersHorizontal className="h-4 w-4 text-slate-600" aria-hidden />
              <h2 className="font-semibold text-gray-900">{module}</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {permissions.map((permission) => {
                const item = draft[permission.id]
                return (
                  <div
                    key={permission.id}
                    className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_130px_120px]"
                  >
                    <label className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={item?.enabled ?? false}
                        onChange={(event) => onChange(permission.id, { enabled: event.target.checked })}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium text-gray-900">{item?.label || defaultLabel(permission)}</span>
                        <span className="block text-xs uppercase text-gray-500">{permission.id}</span>
                      </span>
                    </label>
                    <select
                      value={item?.scope ?? 'own'}
                      onChange={(event) => onChange(permission.id, { scope: event.target.value as PermissionScope })}
                      className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      aria-label={`Alcance de ${permission.id}`}
                    >
                      <option value="own">Propios</option>
                      <option value="all">Todos</option>
                    </select>
                    <span className="inline-flex h-9 items-center rounded-full bg-slate-100 px-3 text-sm font-medium text-slate-700">
                      {scopeLabel(item?.scope ?? 'own')}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    )
  }

  const containerClass = compact ? 'space-y-6' : 'responsive-page max-w-7xl space-y-6'

  return (
    <div className={containerClass}>
      <section className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <ShieldCheck className="h-6 w-6 text-emerald-700" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-gray-950">Gestión de perfiles</h1>
              <p className="max-w-2xl text-sm text-gray-600">
                Creá perfiles y asigná permisos por módulo desde la base de datos.
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                  {totals.profiles} perfiles
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">
                  {totals.assigned} permisos activos
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                  {totals.catalog} permisos disponibles
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewProfileOpen((current) => !current)}
            className="btn-primary inline-flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo perfil
          </button>
        </div>
      </section>

      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-gray-500">Cargando perfiles...</div>
      ) : (
        <section className="space-y-4">
          {newProfileOpen && (
            <article className="rounded-xl border border-emerald-200 bg-white shadow-sm">
              <div className="border-b border-emerald-100 p-4 sm:p-5">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <label className="block text-sm font-medium text-gray-700">
                    Nombre
                    <input
                      value={newProfile.label}
                      onChange={(event) =>
                        setNewProfile((current) => ({
                          ...current,
                          label: event.target.value,
                          code: current.code || slugRoleCode(event.target.value),
                        }))
                      }
                      className="input-field mt-1 bg-white"
                      placeholder="Ej: Coordinador"
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    Código
                    <input
                      value={newProfile.code}
                      onChange={(event) => setNewProfile((current) => ({ ...current, code: slugRoleCode(event.target.value) }))}
                      className="input-field mt-1 bg-white"
                      placeholder="COORDINADOR"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={createProfile}
                    disabled={savingRole === 'new'}
                    className="btn-primary inline-flex h-10 items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" aria-hidden />
                    {savingRole === 'new' ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
              <div className="border-t border-gray-100 p-4 text-sm text-gray-600 sm:p-5">
                Primero creá el perfil. Después seleccionalo en <span className="font-semibold text-gray-800">Perfil a configurar</span> para activar permisos y revisar la vista previa.
              </div>
            </article>
          )}

          {(() => {
            const profile = profiles.find((p) => p.role === selectedRole) ?? profiles[0]
            if (!profile) return null
            const draft = drafts[profile.role] ?? {}
            const active = Object.values(draft).filter((permission) => permission.enabled)
            const byModule = active.reduce<Record<string, DraftPermission[]>>((acc, permission) => {
              const meta = catalog.find((item) => item.id === permission.id)
              const moduleName = meta?.module ?? 'Otros'
              acc[moduleName] = acc[moduleName] || []
              acc[moduleName].push(permission)
              return acc
            }, {})

            return (
              <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="self-start rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Perfil a configurar
                  </label>
                  <select
                    value={profile.role}
                    onChange={(event) => setSelectedRole(event.target.value)}
                    className="input-field mb-3 bg-white text-sm"
                  >
                    {profiles.map((p) => (
                      <option key={p.role} value={p.role}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-gray-950">{profile.label}</p>
                    <p className="text-xs text-gray-500">{profile.role}</p>
                    <p className="mt-2 text-xs text-gray-600">{active.length} permisos activos</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen((current) => !current)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    <Eye className="h-4 w-4" aria-hidden />
                    {previewOpen ? 'Ocultar vista previa' : 'Ver vista previa'}
                  </button>
                </aside>

                <section className="space-y-4">
                  {previewOpen && (
                    <article className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 sm:p-5">
                      <h2 className="text-base font-semibold text-emerald-950">Vista previa del rol</h2>
                      <p className="mt-1 text-sm text-emerald-800">
                        Así quedaría el acceso para una persona con el perfil {profile.label}.
                      </p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {Object.entries(byModule).map(([module, permissions]) => (
                          <div key={module} className="rounded-lg border border-emerald-100 bg-white p-3">
                            <p className="font-medium text-gray-950">{module}</p>
                            <ul className="mt-2 space-y-1 text-sm text-gray-600">
                              {permissions.map((permission) => (
                                <li key={permission.id}>
                                  {permission.label} · {scopeLabel(permission.scope)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </article>
                  )}

                  <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-950">Permisos de {profile.label}</h2>
                        <p className="text-sm text-gray-600">Activá módulos y elegí si ve solo lo propio o todos los registros.</p>
                      </div>
                      <div className="grid gap-2 sm:flex sm:flex-wrap">
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts((current) => ({
                              ...current,
                              [profile.role]: buildDraft(profile, catalog),
                            }))
                          }
                          className="btn-secondary inline-flex items-center gap-2"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden />
                          Deshacer
                        </button>
                        <button
                          type="button"
                          onClick={() => saveProfile(profile.role)}
                          disabled={savingRole === profile.role}
                          className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
                        >
                          {savingRole === profile.role ? <Check className="h-4 w-4" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                          {savingRole === profile.role ? 'Guardando...' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                    {renderPermissionRows(draft, (permissionId, patch) => updateDraft(profile.role, permissionId, patch))}
                  </article>
                </section>
              </div>
            )
          })()}
        </section>
      )}
    </div>
  )
}
