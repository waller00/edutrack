'use client'
import RoleGuard from '@/components/RoleGuard'
import { api } from '@/lib/api'
import {
  ChevronDown,
  Plus,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type ProfileRole = 'ADMIN' | 'TEACHER' | 'STAFF'
type PermissionScope = 'own' | 'all'

type ProfilePermission = {
  id: string
  module: string
  action: string
  label: string
  enabled: boolean
  scope: PermissionScope
}

type Profile = {
  role: ProfileRole
  label: string
  permissions: ProfilePermission[]
}

type ProfilesResponse = {
  roles: Profile[]
}

type NewPermissionForm = {
  module: string
  action: string
  label: string
  scope: PermissionScope
}

const EMPTY_FORM: NewPermissionForm = {
  module: '',
  action: '',
  label: '',
  scope: 'own',
}

const ROLE_DESCRIPTIONS: Record<ProfileRole, string> = {
  ADMIN: 'Acceso administrativo sobre usuarios, módulos operativos y perfiles.',
  TEACHER: 'Perfil Tutor con permisos orientados a sus propios eventos, asistencias y licencias.',
  STAFF: 'Perfil Staff con acceso a su información operativa personal.',
}

function groupPermissions(permissions: ProfilePermission[]) {
  return permissions.reduce<Record<string, ProfilePermission[]>>((acc, permission) => {
    acc[permission.module] = acc[permission.module] || []
    acc[permission.module].push(permission)
    return acc
  }, {})
}

function scopeLabel(scope: PermissionScope) {
  return scope === 'all' ? 'Todos' : 'Propios'
}

export default function AdminProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [openRoles, setOpenRoles] = useState<Record<ProfileRole, boolean>>({
    ADMIN: true,
    TEACHER: true,
    STAFF: false,
  })
  const [forms, setForms] = useState<Record<ProfileRole, NewPermissionForm>>({
    ADMIN: { ...EMPTY_FORM, scope: 'all' },
    TEACHER: { ...EMPTY_FORM },
    STAFF: { ...EMPTY_FORM },
  })
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [creatingRole, setCreatingRole] = useState<ProfileRole | ''>('')
  const [message, setMessage] = useState('')

  async function loadProfiles() {
    setLoading(true)
    setMessage('')
    try {
      const data = await api<ProfilesResponse>('/admin/profiles')
      setProfiles(data.roles)
    } catch (error: any) {
      setMessage(error?.message || 'No se pudieron cargar los perfiles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  const totals = useMemo(() => {
    const total = profiles.reduce((sum, profile) => sum + profile.permissions.length, 0)
    const enabled = profiles.reduce(
      (sum, profile) => sum + profile.permissions.filter((permission) => permission.enabled).length,
      0,
    )
    return { total, enabled }
  }, [profiles])

  function replaceProfiles(data: ProfilesResponse) {
    setProfiles(data.roles)
  }

  async function updatePermission(role: ProfileRole, permission: ProfilePermission, patch: Partial<ProfilePermission>) {
    const key = `${role}:${permission.id}`
    setSavingKey(key)
    setMessage('')
    try {
      const data = await api<ProfilesResponse>(`/admin/profiles/${role}/permissions/${permission.id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      replaceProfiles(data)
      setMessage('Permiso actualizado. No se cambiaron los accesos reales del sistema.')
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo actualizar el permiso')
    } finally {
      setSavingKey('')
    }
  }

  async function createPermission(role: ProfileRole) {
    const form = forms[role]
    setCreatingRole(role)
    setMessage('')
    try {
      const data = await api<ProfilesResponse>(`/admin/profiles/${role}/permissions`, {
        method: 'POST',
        body: JSON.stringify({ ...form, enabled: true }),
      })
      replaceProfiles(data)
      setForms((current) => ({ ...current, [role]: { ...EMPTY_FORM, scope: role === 'ADMIN' ? 'all' : 'own' } }))
      setMessage('Permiso creado en la matriz de perfiles.')
    } catch (error: any) {
      setMessage(error?.message || 'No se pudo crear el permiso')
    } finally {
      setCreatingRole('')
    }
  }

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-7xl p-6 space-y-6">
        <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <div className="grid gap-6 p-6 md:grid-cols-[1fr_320px] md:items-center">
            <div className="space-y-4">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
                <ShieldCheck className="h-6 w-6 text-emerald-700" aria-hidden />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-950">Gestión de perfiles</h1>
                <p className="max-w-2xl text-sm text-gray-600">
                  Administración de roles y permisos por módulo. Esta matriz es editable y no modifica los permisos
                  reales que ya usa la aplicación.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                  {profiles.length || 3} roles
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">
                  {totals.enabled}/{totals.total} permisos activos
                </span>
              </div>
            </div>
            <img
              src="/profile-management.svg"
              alt="Perfiles y permisos organizados por módulo"
              className="mx-auto h-56 w-full max-w-sm object-contain"
            />
          </div>
        </section>

        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {message}
          </div>
        )}

        {loading ? (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-500">Cargando perfiles…</div>
        ) : (
          <section className="space-y-4">
            {profiles.map((profile) => {
              const grouped = groupPermissions(profile.permissions)
              const enabledCount = profile.permissions.filter((permission) => permission.enabled).length
              const form = forms[profile.role]
              return (
                <article key={profile.role} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setOpenRoles((current) => ({ ...current, [profile.role]: !current[profile.role] }))}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
                        <UserCog className="h-5 w-5 text-emerald-700" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-lg font-semibold text-gray-950">{profile.label}</span>
                        <span className="block text-sm text-gray-600">{ROLE_DESCRIPTIONS[profile.role]}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 sm:inline">
                        {enabledCount}/{profile.permissions.length} activos
                      </span>
                      <ChevronDown
                        className={`h-5 w-5 text-gray-500 transition-transform ${openRoles[profile.role] ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </span>
                  </button>

                  {openRoles[profile.role] && (
                    <div className="border-t border-gray-100 p-5">
                      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                        <div className="space-y-4">
                          {Object.entries(grouped).map(([module, permissions]) => (
                            <section key={module} className="rounded-lg border border-gray-200">
                              <div className="flex items-center gap-2 border-b border-gray-100 bg-slate-50 px-4 py-3">
                                <SlidersHorizontal className="h-4 w-4 text-slate-600" aria-hidden />
                                <h2 className="font-semibold text-gray-900">{module}</h2>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {permissions.map((permission) => (
                                  <div
                                    key={permission.id}
                                    className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_120px_120px]"
                                  >
                                    <label className="flex min-w-0 items-start gap-3">
                                      <input
                                        type="checkbox"
                                        checked={permission.enabled}
                                        onChange={(e) =>
                                          updatePermission(profile.role, permission, { enabled: e.target.checked })
                                        }
                                        className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                      />
                                      <span className="min-w-0">
                                        <span className="block font-medium text-gray-900">{permission.label}</span>
                                        <span className="block text-xs uppercase tracking-wide text-gray-500">
                                          {permission.action}
                                        </span>
                                      </span>
                                    </label>
                                    <select
                                      value={permission.scope}
                                      onChange={(e) =>
                                        updatePermission(profile.role, permission, {
                                          scope: e.target.value as PermissionScope,
                                        })
                                      }
                                      className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                      aria-label={`Alcance de ${permission.label}`}
                                    >
                                      <option value="own">{scopeLabel('own')}</option>
                                      <option value="all">{scopeLabel('all')}</option>
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => updatePermission(profile.role, permission, {})}
                                      disabled={savingKey === `${profile.role}:${permission.id}`}
                                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                    >
                                      <Save className="h-4 w-4" aria-hidden />
                                      {savingKey === `${profile.role}:${permission.id}` ? 'Guardando' : 'Guardar'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ))}
                        </div>

                        <aside className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                          <div className="mb-4 flex items-center gap-2">
                            <Plus className="h-5 w-5 text-emerald-700" aria-hidden />
                            <h2 className="font-semibold text-emerald-950">Nuevo permiso</h2>
                          </div>
                          <div className="space-y-3">
                            <input
                              value={form.module}
                              onChange={(e) =>
                                setForms((current) => ({
                                  ...current,
                                  [profile.role]: { ...current[profile.role], module: e.target.value },
                                }))
                              }
                              placeholder="Módulo, por ejemplo Reportes"
                              className="input-field bg-white"
                            />
                            <input
                              value={form.action}
                              onChange={(e) =>
                                setForms((current) => ({
                                  ...current,
                                  [profile.role]: { ...current[profile.role], action: e.target.value },
                                }))
                              }
                              placeholder="Acción, por ejemplo read"
                              className="input-field bg-white"
                            />
                            <input
                              value={form.label}
                              onChange={(e) =>
                                setForms((current) => ({
                                  ...current,
                                  [profile.role]: { ...current[profile.role], label: e.target.value },
                                }))
                              }
                              placeholder="Nombre visible"
                              className="input-field bg-white"
                            />
                            <select
                              value={form.scope}
                              onChange={(e) =>
                                setForms((current) => ({
                                  ...current,
                                  [profile.role]: { ...current[profile.role], scope: e.target.value as PermissionScope },
                                }))
                              }
                              className="select-field bg-white"
                              aria-label={`Alcance para nuevo permiso de ${profile.label}`}
                            >
                              <option value="own">Propios</option>
                              <option value="all">Todos</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => createPermission(profile.role)}
                              disabled={creatingRole === profile.role}
                              className="btn-primary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60"
                            >
                              <Plus className="h-4 w-4" aria-hidden />
                              {creatingRole === profile.role ? 'Creando…' : 'Crear permiso'}
                            </button>
                          </div>
                        </aside>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        )}
      </main>
    </RoleGuard>
  )
}
