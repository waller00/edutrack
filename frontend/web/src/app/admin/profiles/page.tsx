'use client'
import Image from 'next/image'
import RoleGuard from '@/components/RoleGuard'
import { api } from '@/lib/api'
import {
  CheckCircle2,
  ChevronDown,
  LockKeyhole,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type ProfileRole = 'ADMIN' | 'TEACHER' | 'STAFF'
type PermissionScope = 'own' | 'all'
type PermissionSource = 'system' | 'custom'

type ProfilePermission = {
  id: string
  module: string
  action: string
  label: string
  enabled: boolean
  scope: PermissionScope
  source?: PermissionSource
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

const MODULE_OPTIONS = ['Asistencias', 'Eventos', 'Licencias', 'Usuarios', 'Reportes', 'Analytics', 'Notificaciones']
const ACTION_OPTIONS = [
  { value: 'read', label: 'read - Ver' },
  { value: 'create', label: 'create - Crear' },
  { value: 'update', label: 'update - Editar' },
  { value: 'delete', label: 'delete - Eliminar' },
  { value: 'manage', label: 'manage - Gestionar' },
]

const EMPTY_FORM: NewPermissionForm = {
  module: 'Reportes',
  action: 'read',
  label: '',
  scope: 'own',
}

const ROLE_DESCRIPTIONS: Record<ProfileRole, string> = {
  ADMIN: 'Puede administrar usuarios y módulos operativos completos.',
  TEACHER: 'Tutor: ve sus asistencias, eventos asignados y licencias registradas por la institución.',
  STAFF: 'Staff: ve sus asistencias, eventos asignados y licencias registradas por la institución.',
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

function sourceLabel(source?: PermissionSource) {
  return source === 'custom' ? 'Documentado' : 'Actual del sistema'
}

function sourceClass(source?: PermissionSource) {
  return source === 'custom'
    ? 'bg-blue-50 text-blue-700 border-blue-100'
    : 'bg-emerald-50 text-emerald-700 border-emerald-100'
}

export default function AdminProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [openRoles, setOpenRoles] = useState<Record<ProfileRole, boolean>>({
    ADMIN: true,
    TEACHER: true,
    STAFF: true,
  })
  const [forms, setForms] = useState<Record<ProfileRole, NewPermissionForm>>({
    ADMIN: { ...EMPTY_FORM, scope: 'all' },
    TEACHER: { ...EMPTY_FORM },
    STAFF: { ...EMPTY_FORM },
  })
  const [createOpenRole, setCreateOpenRole] = useState<ProfileRole | ''>('')
  const [loading, setLoading] = useState(true)
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
    const system = profiles.reduce(
      (sum, profile) => sum + profile.permissions.filter((permission) => permission.source !== 'custom').length,
      0,
    )
    return { total, system }
  }, [profiles])

  function normalizePermissionId(module: string, action: string) {
    const clean = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    return `${clean(module)}.${clean(action)}`
  }

  function updatePermission(role: ProfileRole, permission: ProfilePermission, patch: Partial<ProfilePermission>) {
    if (permission.source !== 'custom') return
    setProfiles((current) =>
      current.map((profile) =>
        profile.role === role
          ? {
              ...profile,
              permissions: profile.permissions.map((item) =>
                item.id === permission.id ? { ...item, ...patch } : item,
              ),
            }
          : profile,
      ),
    )
    setMessage('Permiso documentado actualizado solo en esta pantalla. No se tocó base de datos ni permisos reales.')
  }

  function createPermission(role: ProfileRole) {
    const form = forms[role]
    if (!form.label.trim()) {
      setMessage('Completá el nombre visible del permiso.')
      return
    }
    setCreatingRole(role)
    setMessage('')
    const baseId = normalizePermissionId(form.module, form.action)
    setProfiles((current) =>
      current.map((profile) => {
        if (profile.role !== role) return profile
        const id = profile.permissions.some((permission) => permission.id === baseId)
          ? `${baseId}.documentado-${Date.now()}`
          : baseId
        return {
          ...profile,
          permissions: [
            ...profile.permissions,
            {
              id,
              module: form.module,
              action: form.action,
              label: form.label.trim(),
              enabled: true,
              scope: form.scope,
              source: 'custom',
            },
          ],
        }
      }),
    )
    setForms((current) => ({ ...current, [role]: { ...EMPTY_FORM, scope: role === 'ADMIN' ? 'all' : 'own' } }))
    setCreateOpenRole('')
    setCreatingRole('')
    setMessage('Permiso documentado agregado solo en esta pantalla. No se tocó base de datos ni permisos reales.')
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
                  Vista administrativa de los permisos actuales por rol. Los permisos del sistema aparecen bloqueados;
                  los nuevos permisos quedan como documentación y no cambian accesos reales.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                  {profiles.length || 3} roles
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">
                  {totals.system}/{totals.total} actuales del sistema
                </span>
              </div>
            </div>
            <Image
              src="/profile-management.svg"
              alt="Perfiles y permisos organizados por módulo"
              width={320}
              height={220}
              className="mx-auto h-56 w-full max-w-sm object-contain"
              priority
            />
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
            {profiles.map((profile) => {
              const grouped = groupPermissions(profile.permissions)
              const systemCount = profile.permissions.filter((permission) => permission.source !== 'custom').length
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
                        {systemCount} actuales
                      </span>
                      <ChevronDown
                        className={`h-5 w-5 text-gray-500 transition-transform ${openRoles[profile.role] ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </span>
                  </button>

                  {openRoles[profile.role] && (
                    <div className="border-t border-gray-100 p-5">
                      <div className="mb-4 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setCreateOpenRole((current) => (current === profile.role ? '' : profile.role))}
                          className="btn-secondary inline-flex items-center gap-2"
                        >
                          {createOpenRole === profile.role ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                          {createOpenRole === profile.role ? 'Cerrar' : 'Agregar permiso documentado'}
                        </button>
                      </div>

                      {createOpenRole === profile.role && (
                        <div className="mb-5 rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                          <h2 className="mb-3 font-semibold text-emerald-950">Agregar permiso documentado para {profile.label}</h2>
                          <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_1fr_auto] md:items-end">
                            <label className="block text-sm font-medium text-gray-700">
                              Módulo
                              <select
                                value={form.module}
                                onChange={(e) =>
                                  setForms((current) => ({
                                    ...current,
                                    [profile.role]: { ...current[profile.role], module: e.target.value },
                                  }))
                                }
                                className="select-field mt-1 bg-white"
                              >
                                {MODULE_OPTIONS.map((module) => (
                                  <option key={module} value={module}>{module}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-sm font-medium text-gray-700">
                              Acción
                              <select
                                value={form.action}
                                onChange={(e) =>
                                  setForms((current) => ({
                                    ...current,
                                    [profile.role]: { ...current[profile.role], action: e.target.value },
                                  }))
                                }
                                className="select-field mt-1 bg-white"
                              >
                                {ACTION_OPTIONS.map((action) => (
                                  <option key={action.value} value={action.value}>{action.label}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-sm font-medium text-gray-700">
                              Nombre visible
                              <input
                                value={form.label}
                                onChange={(e) =>
                                  setForms((current) => ({
                                    ...current,
                                    [profile.role]: { ...current[profile.role], label: e.target.value },
                                  }))
                                }
                                placeholder="Ej: Ver reportes mensuales"
                                className="input-field mt-1 bg-white"
                              />
                            </label>
                            <label className="block text-sm font-medium text-gray-700">
                              Alcance
                              <select
                                value={form.scope}
                                onChange={(e) =>
                                  setForms((current) => ({
                                    ...current,
                                    [profile.role]: { ...current[profile.role], scope: e.target.value as PermissionScope },
                                  }))
                                }
                                className="select-field mt-1 bg-white"
                              >
                                <option value="own">Propios</option>
                                <option value="all">Todos</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() => createPermission(profile.role)}
                              disabled={creatingRole === profile.role}
                              className="btn-primary inline-flex h-10 items-center justify-center gap-2 disabled:opacity-60"
                            >
                              <Plus className="h-4 w-4" aria-hidden />
                              {creatingRole === profile.role ? 'Agregando...' : 'Agregar'}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-4">
                        {Object.entries(grouped).map(([module, permissions]) => (
                          <section key={module} className="rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 border-b border-gray-100 bg-slate-50 px-4 py-3">
                              <SlidersHorizontal className="h-4 w-4 text-slate-600" aria-hidden />
                              <h2 className="font-semibold text-gray-900">{module}</h2>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {permissions.map((permission) => {
                                const isCustom = permission.source === 'custom'
                                return (
                                  <div
                                    key={permission.id}
                                    className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_120px_120px_150px]"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        {permission.enabled ? (
                                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                                        ) : (
                                          <X className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                                        )}
                                        <span className="font-medium text-gray-900">{permission.label}</span>
                                      </div>
                                      <span className="ml-6 block text-xs uppercase tracking-wide text-gray-500">{permission.action}</span>
                                    </div>
                                    <span className="inline-flex h-8 items-center rounded-full bg-slate-100 px-3 text-sm font-medium text-slate-700">
                                      {scopeLabel(permission.scope)}
                                    </span>
                                    <span className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold ${sourceClass(permission.source)}`}>
                                      {isCustom ? null : <LockKeyhole className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                                      {sourceLabel(permission.source)}
                                    </span>
                                    {isCustom ? (
                                      <div className="flex items-center gap-2">
                                        <label className="flex items-center gap-2 text-sm text-gray-700">
                                          <input
                                            type="checkbox"
                                            checked={permission.enabled}
                                            onChange={(e) =>
                                              updatePermission(profile.role, permission, { enabled: e.target.checked })
                                            }
                                            className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                          />
                                          Activo
                                        </label>
                                        <select
                                          value={permission.scope}
                                          onChange={(e) =>
                                            updatePermission(profile.role, permission, {
                                              scope: e.target.value as PermissionScope,
                                            })
                                          }
                                          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                          aria-label={`Alcance de ${permission.label}`}
                                        >
                                          <option value="own">Propios</option>
                                          <option value="all">Todos</option>
                                        </select>
                                      </div>
                                    ) : (
                                      <span className="text-sm text-gray-500">Bloqueado</span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </section>
                        ))}
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
