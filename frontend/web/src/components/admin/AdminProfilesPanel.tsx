'use client'

import { api } from '@/lib/api/client'
import SettingsDetails from './settings/SettingsDetails'
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Plus,
  Power,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

type OrgRoleMeta = {
  code: string
  label: string
  builtIn: boolean
  active: boolean
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
}

const EMPTY_NEW_PROFILE: NewProfileForm = {
  code: '',
  label: '',
}

function groupCatalog(permissions: PermissionCatalogItem[]) {
  return permissions.reduce<Record<string, PermissionCatalogItem[]>>(
    (acc, permission) => {
      acc[permission.module] = acc[permission.module] || []
      acc[permission.module].push(permission)
      return acc
    },
    {},
  )
}

function scopeLabel(scope: PermissionScope) {
  return scope === 'all' ? 'Todos los registros' : 'Registros propios'
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
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
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
  return trimRepeatedChar(normalized, '_').toUpperCase()
}

function buildDraft(
  profile: Profile,
  catalog: PermissionCatalogItem[],
): Record<string, DraftPermission> {
  const assigned = new Map(
    profile.permissions.map((permission) => [permission.id, permission]),
  )
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

/** Refleja "algunos pero no todos" como estado indeterminado del checkbox del módulo. */
function applyIndeterminate(
  el: HTMLInputElement | null,
  indeterminate: boolean,
) {
  if (el) el.indeterminate = indeterminate
}

/** Compara dos borradores para detectar cambios sin guardar. */
function draftsEqual(
  a: Record<string, DraftPermission>,
  b: Record<string, DraftPermission>,
) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const x = a[key]
    const y = b[key]
    if (!x || !y) return false
    if (x.enabled !== y.enabled || x.scope !== y.scope || x.label !== y.label)
      return false
  }
  return true
}

export default function AdminProfilesPanel({
  compact = false,
}: { compact?: boolean } = {}) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([])
  const [roleMeta, setRoleMeta] = useState<Record<string, OrgRoleMeta>>({})
  const [drafts, setDrafts] = useState<
    Record<string, Record<string, DraftPermission>>
  >({})
  const [selectedRole, setSelectedRole] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [profileSearch, setProfileSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all')
  const [permissionSearch, setPermissionSearch] = useState('')
  const [editorView, setEditorView] = useState<'permissions' | 'summary'>(
    'permissions',
  )
  const [editLabels, setEditLabels] = useState(false)
  const [newProfileOpen, setNewProfileOpen] = useState(false)
  const [newProfile, setNewProfile] =
    useState<NewProfileForm>(EMPTY_NEW_PROFILE)
  const [renameDraft, setRenameDraft] = useState('')
  const [savingRole, setSavingRole] = useState('')
  const [roleActionBusy, setRoleActionBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)
  const profilesRef = useRef<Profile[]>([])
  const catalogRef = useRef<PermissionCatalogItem[]>([])
  const loadRequest = useRef(0)

  const applyProfiles = useCallback(
    (data: ProfilesResponse, savedRole?: string) => {
      const previousProfiles = profilesRef.current
      const previousCatalog = catalogRef.current
      profilesRef.current = data.roles
      catalogRef.current = data.permissionCatalog
      setProfiles(data.roles)
      setCatalog(data.permissionCatalog)
      setDrafts((current) =>
        Object.fromEntries(
          data.roles.map((profile) => {
            const fresh = buildDraft(profile, data.permissionCatalog)
            const previous = previousProfiles.find(
              (item) => item.role === profile.role,
            )
            const draft = current[profile.role]
            // Guardar un perfil o actualizar sus datos no debe borrar borradores de otros perfiles.
            if (
              profile.role !== savedRole &&
              previous &&
              draft &&
              !draftsEqual(draft, buildDraft(previous, previousCatalog))
            ) {
              return [
                profile.role,
                Object.fromEntries(
                  Object.entries(fresh).map(([id, item]) => [
                    id,
                    draft[id] ?? item,
                  ]),
                ),
              ]
            }
            return [profile.role, fresh]
          }),
        ),
      )
      setSelectedRole((current) => current || data.roles[0]?.role || '')
    },
    [],
  )

  const loadProfiles = useCallback(async () => {
    const request = ++loadRequest.current
    setLoading(true)
    setLoadError(false)
    setMessage('')
    try {
      const [data, metaRows] = await Promise.all([
        api<ProfilesResponse>('/admin/profiles'),
        api<OrgRoleMeta[]>('/admin/org-roles'),
      ])
      if (request !== loadRequest.current) return false
      applyProfiles(data)
      setRoleMeta(Object.fromEntries(metaRows.map((row) => [row.code, row])))
      return true
    } catch (error) {
      if (request !== loadRequest.current) return false
      setLoadError(true)
      setMessageError(true)
      setMessage(errorMessage(error, 'No se pudieron cargar los perfiles.'))
      return false
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }, [applyProfiles])

  useEffect(() => {
    void loadProfiles()
    return () => {
      loadRequest.current += 1
    }
  }, [loadProfiles])

  const groupedCatalog = useMemo(() => groupCatalog(catalog), [catalog])
  // /profiles devuelve los perfiles activos; la metadata permite listar y reactivar los inactivos.
  const allProfiles = useMemo(
    () => [
      ...profiles,
      ...Object.values(roleMeta)
        .filter(
          (meta) => !profiles.some((profile) => profile.role === meta.code),
        )
        .map(
          (meta) =>
            ({
              role: meta.code,
              label: meta.label,
              permissions: [],
            }) as Profile,
        ),
    ],
    [profiles, roleMeta],
  )
  const visibleProfiles = useMemo(() => {
    const query = normalizeSearch(profileSearch)
    return allProfiles.filter((profile) => {
      const active = roleMeta[profile.role]?.active ?? true
      return (
        (statusFilter === 'all' ||
          (statusFilter === 'active' ? active : !active)) &&
        (!query ||
          normalizeSearch(`${profile.label} ${profile.role}`).includes(query))
      )
    })
  }, [allProfiles, profileSearch, statusFilter, roleMeta])

  const selectedProfile =
    allProfiles.find((profile) => profile.role === selectedRole) ??
    allProfiles[0] ??
    null
  const selectedBuiltIn = selectedProfile
    ? (roleMeta[selectedProfile.role]?.builtIn ?? true)
    : true
  const selectedActive = selectedProfile
    ? (roleMeta[selectedProfile.role]?.active ?? true)
    : false
  const draft = selectedProfile ? (drafts[selectedProfile.role] ?? {}) : {}
  const activePermissions = Object.values(draft).filter(
    (permission) => permission.enabled,
  )
  const selectedDirty = Boolean(
    selectedProfile &&
    selectedActive &&
    !draftsEqual(draft, buildDraft(selectedProfile, catalog)),
  )
  const busy = loading || Boolean(savingRole) || roleActionBusy
  const query = normalizeSearch(permissionSearch)
  const filteredModules = Object.entries(groupedCatalog)
    .map(
      ([module, permissions]) =>
        [
          module,
          permissions.filter(
            (permission) =>
              !query ||
              normalizeSearch(
                `${module} ${permission.id} ${draft[permission.id]?.label ?? defaultLabel(permission)}`,
              ).includes(query),
          ),
        ] as const,
    )
    .filter(([, permissions]) => permissions.length > 0)
  const byModule = Object.entries(groupedCatalog)
    .map(
      ([module, permissions]) =>
        [
          module,
          permissions
            .map((permission) => draft[permission.id])
            .filter((permission) => permission?.enabled),
        ] as const,
    )
    .filter(([, permissions]) => permissions.length > 0)

  useEffect(() => {
    setRenameDraft(selectedProfile?.label ?? '')
    setPermissionSearch('')
    setEditorView('permissions')
    setEditLabels(false)
  }, [selectedProfile?.role, selectedProfile?.label])

  const anyDirty = profiles.some(
    (profile) =>
      !draftsEqual(drafts[profile.role] ?? {}, buildDraft(profile, catalog)),
  )
  useEffect(() => {
    if (!anyDirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anyDirty])

  function updateDraft(permissionId: string, patch: Partial<DraftPermission>) {
    if (!selectedProfile) return
    const role = selectedProfile.role
    setDrafts((current) => ({
      ...current,
      [role]: {
        ...current[role],
        [permissionId]: { ...current[role][permissionId], ...patch },
      },
    }))
  }

  function setModuleEnabled(module: string, enabled: boolean) {
    if (!selectedProfile) return
    const role = selectedProfile.role
    const ids = new Set(
      groupedCatalog[module].map((permission) => permission.id),
    )
    setDrafts((current) => ({
      ...current,
      [role]: Object.fromEntries(
        Object.entries(current[role] ?? {}).map(([id, item]) => [
          id,
          ids.has(id) ? { ...item, enabled } : item,
        ]),
      ),
    }))
  }

  function startAction() {
    setMessage('')
    setMessageError(false)
  }
  function reportError(error: unknown, fallback: string) {
    setMessageError(true)
    setMessage(errorMessage(error, fallback))
  }

  async function saveProfile() {
    if (!selectedProfile || !selectedActive || !selectedDirty) return
    const role = selectedProfile.role
    setSavingRole(role)
    startAction()
    try {
      const data = await api<ProfilesResponse>(
        `/admin/profiles/${role}/permissions`,
        {
          method: 'PUT',
          body: JSON.stringify({ permissions: Object.values(draft) }),
        },
      )
      applyProfiles(data, role)
      setMessage('Perfil guardado.')
    } catch (error) {
      reportError(error, 'No se pudo guardar el perfil.')
    } finally {
      setSavingRole('')
    }
  }

  async function createProfile() {
    const code = slugRoleCode(newProfile.code || newProfile.label)
    if (!code || newProfile.label.trim().length < 2) {
      reportError(
        null,
        'Completá el nombre del perfil (al menos dos caracteres).',
      )
      return
    }
    setSavingRole('new')
    startAction()
    try {
      const data = await api<ProfilesResponse>('/admin/profiles', {
        method: 'POST',
        body: JSON.stringify({
          code,
          label: newProfile.label.trim(),
          permissions: Object.values(
            buildDraft(
              { role: code, label: newProfile.label, permissions: [] },
              catalog,
            ),
          ),
        }),
      })
      applyProfiles(data)
      setNewProfile(EMPTY_NEW_PROFILE)
      setNewProfileOpen(false)
      const refreshed = await loadProfiles()
      setSelectedRole(code)
      setShowEditor(true)
      setProfileSearch('')
      setStatusFilter('all')
      if (refreshed)
        setMessage(
          'Perfil creado. Activá los permisos que necesita y guardá los cambios.',
        )
    } catch (error) {
      reportError(error, 'No se pudo crear el perfil.')
    } finally {
      setSavingRole('')
    }
  }

  async function roleAction(action: 'rename' | 'toggle' | 'delete') {
    if (!selectedProfile || busy || selectedDirty) return
    if (action !== 'rename' && selectedBuiltIn) return
    const role = selectedProfile.role
    if (
      action === 'delete' &&
      !globalThis.confirm(
        `¿Eliminar el perfil "${selectedProfile.label}"? Esta acción no se puede deshacer.`,
      )
    )
      return
    setRoleActionBusy(true)
    startAction()
    try {
      await api(
        `/admin/org-roles/${role}`,
        action === 'delete'
          ? { method: 'DELETE' }
          : {
              method: 'PATCH',
              body: JSON.stringify(
                action === 'rename'
                  ? { label: renameDraft.trim() }
                  : { active: !selectedActive },
              ),
            },
      )
      if (action === 'delete') {
        setSelectedRole('')
        setShowEditor(false)
      }
      const refreshed = await loadProfiles()
      if (refreshed)
        setMessage(
          action === 'rename'
            ? 'Perfil renombrado.'
            : action === 'delete'
              ? 'Perfil eliminado.'
              : selectedActive
                ? 'Perfil desactivado.'
                : 'Perfil activado.',
        )
    } catch (error) {
      reportError(error, 'No se pudo actualizar el perfil.')
    } finally {
      setRoleActionBusy(false)
    }
  }

  function selectProfile(profile: Profile) {
    setSelectedRole(profile.role)
    setShowEditor(true)
    setMessage('')
  }

  function renderPermission(permission: PermissionCatalogItem) {
    const item = draft[permission.id]
    return (
      <div
        key={permission.id}
        className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_185px] sm:items-center"
      >
        <div className="flex min-w-0 items-start gap-3">
          <input
            id={`grant-${selectedRole}-${permission.id}`}
            type="checkbox"
            checked={item?.enabled ?? false}
            disabled={busy}
            onChange={(event) =>
              updateDraft(permission.id, { enabled: event.target.checked })
            }
            className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            aria-label={`Activar ${permission.id}`}
          />
          {editLabels ? (
            <div className="min-w-0 flex-1">
              <input
                value={item?.label ?? defaultLabel(permission)}
                maxLength={80}
                disabled={busy}
                onChange={(event) =>
                  updateDraft(permission.id, { label: event.target.value })
                }
                className="input-field text-sm"
                aria-label={`Nombre visible de ${permission.id}`}
              />
              <span className="mt-1 block break-all text-xs text-slate-500">
                {permission.id}
              </span>
            </div>
          ) : (
            <label
              htmlFor={`grant-${selectedRole}-${permission.id}`}
              className="min-w-0 flex-1 cursor-pointer text-sm text-slate-800"
            >
              {item?.label ?? defaultLabel(permission)}
            </label>
          )}
        </div>
        <select
          value={item?.scope ?? 'own'}
          disabled={busy || !item?.enabled}
          onChange={(event) =>
            updateDraft(permission.id, {
              scope: event.target.value as PermissionScope,
            })
          }
          className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
          aria-label={`Alcance de ${permission.id}`}
        >
          <option value="own">Registros propios</option>
          <option value="all">Todos los registros</option>
        </select>
      </div>
    )
  }

  return (
    <main
      className={compact ? 'space-y-4' : 'responsive-page max-w-7xl space-y-4'}
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Roles / Perfiles
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Elegí un perfil y definí qué puede ver y hacer.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setNewProfileOpen(true)
            startAction()
          }}
          disabled={busy || newProfileOpen}
          className="btn-primary gap-2 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nuevo perfil
        </button>
      </header>

      {message && (
        <div
          role={messageError ? 'alert' : 'status'}
          className={`rounded-xl border p-4 text-sm ${messageError ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
          {message}
          {loadError && (
            <button
              type="button"
              onClick={loadProfiles}
              className="ml-3 font-semibold underline"
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {newProfileOpen && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void createProfile()
          }}
          aria-label="Crear perfil"
          className="space-y-4 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5"
        >
          <div>
            <h2 className="font-semibold text-slate-900">Crear perfil</h2>
            <p className="mt-1 text-sm text-slate-600">
              Después de crearlo, elegí sus permisos.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Nombre
              <input
                autoFocus
                required
                minLength={2}
                maxLength={80}
                value={newProfile.label}
                disabled={busy}
                onChange={(event) =>
                  setNewProfile((current) => ({
                    ...current,
                    label: event.target.value,
                  }))
                }
                className="input-field mt-1"
                placeholder="Ej: Coordinador"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Código
              <input
                required
                minLength={2}
                maxLength={48}
                value={newProfile.code || slugRoleCode(newProfile.label)}
                disabled={busy}
                onChange={(event) =>
                  setNewProfile((current) => ({
                    ...current,
                    code: slugRoleCode(event.target.value),
                  }))
                }
                className="input-field mt-1"
                placeholder="COORDINADOR"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Se completa a partir del nombre; podés cambiarlo.
              </span>
            </label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setNewProfileOpen(false)
                setNewProfile(EMPTY_NEW_PROFILE)
              }}
              className="btn-secondary"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary gap-2 disabled:opacity-50"
            >
              {savingRole === 'new' && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              Crear perfil
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 rounded-xl border bg-white p-8 text-sm text-slate-500"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando perfiles…
        </div>
      ) : (
        !loadError && (
          <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside
              aria-label="Lista de perfiles"
              className={`${showEditor ? 'hidden lg:block' : ''} min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm`}
            >
              <div className="space-y-3 border-b border-slate-100 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-slate-900">Perfiles</h2>
                  <span className="text-xs text-slate-500">
                    {allProfiles.length} en total
                  </span>
                </div>
                <label className="relative block">
                  <span className="sr-only">Buscar perfil</span>
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={profileSearch}
                    onChange={(event) => setProfileSearch(event.target.value)}
                    placeholder="Nombre o código"
                    className="input-field min-h-10 pl-9 text-sm"
                  />
                </label>
                <div
                  role="group"
                  aria-label="Filtrar perfiles por estado"
                  className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1"
                >
                  {(
                    [
                      { value: 'all', label: 'Todos' },
                      { value: 'active', label: 'Activos' },
                      { value: 'inactive', label: 'Inactivos' },
                    ] as const
                  ).map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      aria-pressed={statusFilter === filter.value}
                      onClick={() => setStatusFilter(filter.value)}
                      className={`min-h-9 rounded-md px-1 py-1.5 text-xs font-medium ${statusFilter === filter.value ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-slate-100 lg:max-h-[640px] lg:overflow-y-auto">
                {visibleProfiles.map((profile) => {
                  const meta = roleMeta[profile.role]
                  const active = meta?.active ?? true
                  const builtIn = meta?.builtIn ?? true
                  const count = Object.values(
                    drafts[profile.role] ?? {},
                  ).filter((item) => item.enabled).length
                  const dirty =
                    active &&
                    !draftsEqual(
                      drafts[profile.role] ?? {},
                      buildDraft(profile, catalog),
                    )
                  return (
                    <button
                      key={profile.role}
                      type="button"
                      disabled={busy}
                      onClick={() => selectProfile(profile)}
                      aria-pressed={selectedProfile?.role === profile.role}
                      aria-label={`Configurar ${profile.label}`}
                      className={`w-full border-l-4 p-4 text-left transition ${selectedProfile?.role === profile.role ? 'border-l-emerald-500 bg-emerald-50/60' : 'border-l-transparent hover:bg-slate-50'}`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 font-medium text-slate-900">
                          {profile.label}
                        </span>
                        {!active && (
                          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                            Inactivo
                          </span>
                        )}
                        {dirty && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
                            aria-label="Cambios sin guardar"
                          />
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {builtIn ? 'Del sistema' : 'Personalizado'}
                        {active
                          ? ` · ${count} ${count === 1 ? 'permiso habilitado' : 'permisos habilitados'}`
                          : ''}
                      </span>
                    </button>
                  )
                })}
                {!visibleProfiles.length && (
                  <div className="p-5 text-sm text-slate-500">
                    {allProfiles.length
                      ? 'No hay perfiles que coincidan con los filtros.'
                      : 'Todavía no hay perfiles.'}
                    {allProfiles.length > 0 && (
                      <button
                        type="button"
                        className="mt-2 block font-medium text-emerald-700 underline"
                        onClick={() => {
                          setProfileSearch('')
                          setStatusFilter('all')
                        }}
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                )}
              </div>
            </aside>

            {selectedProfile && (
              <section
                aria-label={`Configuración de ${selectedProfile.label}`}
                className={`${showEditor ? '' : 'hidden lg:block'} min-w-0 space-y-4`}
              >
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-emerald-700 lg:hidden"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Volver a perfiles
                </button>
                <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="space-y-4 border-b border-slate-100 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-slate-950">
                            {selectedProfile.label}
                          </h2>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${selectedActive ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}
                          >
                            {selectedActive ? 'Activo' : 'Inactivo'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {selectedBuiltIn
                            ? 'Perfil del sistema'
                            : 'Perfil personalizado'}{' '}
                          · {selectedProfile.role}
                        </p>
                      </div>
                      {selectedActive && (
                        <button
                          type="button"
                          onClick={saveProfile}
                          disabled={
                            busy ||
                            !selectedDirty ||
                            Object.values(draft).some(
                              (item) => !item.label.trim(),
                            )
                          }
                          className="btn-primary shrink-0 gap-2 disabled:opacity-50"
                        >
                          {savingRole === selectedProfile.role ? (
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden
                            />
                          ) : (
                            <Save className="h-4 w-4" aria-hidden />
                          )}
                          {savingRole === selectedProfile.role
                            ? 'Guardando…'
                            : 'Guardar cambios'}
                        </button>
                      )}
                    </div>
                    {selectedActive && (
                      <>
                        <div
                          role="group"
                          aria-label="Vista del perfil"
                          className="flex gap-1 rounded-lg bg-slate-100 p-1"
                        >
                          {(
                            [
                              { value: 'permissions', label: 'Permisos' },
                              { value: 'summary', label: 'Resumen de accesos' },
                            ] as const
                          ).map((view) => (
                            <button
                              key={view.value}
                              type="button"
                              aria-pressed={editorView === view.value}
                              onClick={() => setEditorView(view.value)}
                              className={`min-h-10 flex-1 rounded-md px-3 py-2 text-sm font-medium ${editorView === view.value ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}
                            >
                              {view.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-slate-500">
                            {activePermissions.length} permisos habilitados
                            {selectedDirty ? ' · Cambios sin guardar' : ''}
                          </span>
                          {selectedDirty && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setDrafts((current) => ({
                                  ...current,
                                  [selectedProfile.role]: buildDraft(
                                    selectedProfile,
                                    catalog,
                                  ),
                                }))
                              }
                              className="inline-flex min-h-9 items-center gap-1 font-medium text-slate-600 hover:text-slate-900"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              Deshacer cambios
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {!selectedActive ? (
                    <div className="p-5 text-sm text-slate-600">
                      Este perfil está desactivado. Activá el perfil desde sus
                      opciones para consultar y editar sus permisos.
                    </div>
                  ) : editorView === 'summary' ? (
                    <div className="space-y-4 p-4 sm:p-5">
                      <p className="text-sm text-slate-600">
                        Accesos habilitados para este perfil.
                        {selectedDirty &&
                          ' Este resumen incluye cambios que todavía no se guardaron.'}
                      </p>
                      {byModule.map(([module, permissions]) => (
                        <section
                          key={module}
                          className="rounded-lg border border-slate-200 p-4"
                        >
                          <h3 className="text-sm font-semibold text-slate-900">
                            {module}
                          </h3>
                          <ul className="mt-3 space-y-2">
                            {permissions.map((permission) => (
                              <li
                                key={permission.id}
                                className="flex flex-col justify-between gap-1 text-sm sm:flex-row sm:gap-3"
                              >
                                <span className="text-slate-700">
                                  {permission.label}
                                </span>
                                <span className="shrink-0 text-xs text-slate-500">
                                  {scopeLabel(permission.scope)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                      {!byModule.length && (
                        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
                          Este perfil no tiene permisos habilitados.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4 p-4 sm:p-5">
                      <p className="text-sm text-slate-600">
                        Abrí un módulo para activar permisos y elegir qué
                        registros puede consultar.
                      </p>
                      <label className="relative block">
                        <span className="sr-only">Buscar permiso</span>
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                          aria-hidden
                        />
                        <input
                          type="search"
                          value={permissionSearch}
                          onChange={(event) =>
                            setPermissionSearch(event.target.value)
                          }
                          placeholder="Buscar módulo o permiso"
                          className="input-field min-h-10 pl-9 text-sm"
                        />
                      </label>
                      <div className="grid items-start gap-3 md:grid-cols-2">
                        {filteredModules.map(([module, permissions]) => {
                          const allItems = groupedCatalog[module]
                          const enabledCount = allItems.filter(
                            (permission) => draft[permission.id]?.enabled,
                          ).length
                          return (
                            <details
                              key={`${selectedProfile.role}-${module}`}
                              open={query ? true : undefined}
                              className="group min-w-0 overflow-hidden rounded-xl border border-slate-200 md:open:col-span-2"
                            >
                              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden">
                                <span className="flex min-w-0 items-center gap-2">
                                  <SlidersHorizontal
                                    className="h-4 w-4 shrink-0 text-slate-400"
                                    aria-hidden
                                  />
                                  <span className="text-sm font-medium text-slate-900">
                                    {module}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  <span className="text-xs text-slate-500">
                                    {enabledCount} de {allItems.length}
                                  </span>
                                  <ChevronDown
                                    className="h-4 w-4 text-slate-400 transition group-open:rotate-180"
                                    aria-hidden
                                  />
                                </span>
                              </summary>
                              <div className="border-t border-slate-100">
                                {!query && (
                                  <label className="flex min-h-11 items-center gap-2 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={enabledCount === allItems.length}
                                      disabled={busy}
                                      ref={(el) =>
                                        applyIndeterminate(
                                          el,
                                          enabledCount > 0 &&
                                            enabledCount < allItems.length,
                                        )
                                      }
                                      onChange={(event) =>
                                        setModuleEnabled(
                                          module,
                                          event.target.checked,
                                        )
                                      }
                                      className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                      aria-label={`Activar todo el módulo ${module}`}
                                    />
                                    Activar todo el módulo
                                  </label>
                                )}
                                <div className="divide-y divide-slate-100">
                                  {permissions.map(renderPermission)}
                                </div>
                              </div>
                            </details>
                          )
                        })}
                      </div>
                      {!filteredModules.length && (
                        <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
                          {catalog.length
                            ? 'No se encontraron permisos.'
                            : 'No hay permisos disponibles.'}
                          {query && (
                            <button
                              type="button"
                              onClick={() => setPermissionSearch('')}
                              className="mt-2 block font-medium text-emerald-700 underline"
                            >
                              Limpiar búsqueda
                            </button>
                          )}
                        </div>
                      )}
                      <SettingsDetails
                        title="Personalizar nombres de permisos"
                        description="Cambiá cómo se identifican los permisos de este perfil."
                      >
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={editLabels}
                            onChange={(event) =>
                              setEditLabels(event.target.checked)
                            }
                            className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                          />
                          Editar nombres visibles
                        </label>
                      </SettingsDetails>
                    </div>
                  )}
                </article>

                <SettingsDetails
                  key={selectedProfile.role}
                  title="Opciones del perfil"
                  description="Nombre, estado y otras acciones."
                >
                  {selectedDirty && (
                    <p className="text-sm text-amber-800">
                      Guardá o deshacé los cambios de permisos antes de
                      modificar el perfil.
                    </p>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void roleAction('rename')
                    }}
                    className="space-y-2"
                  >
                    <label
                      htmlFor="profile-rename-input"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Nombre del perfil
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="profile-rename-input"
                        value={renameDraft}
                        required
                        minLength={2}
                        maxLength={80}
                        disabled={busy || selectedDirty}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        className="input-field text-sm"
                        aria-label="Nuevo nombre del perfil"
                      />
                      <button
                        type="submit"
                        disabled={
                          busy ||
                          selectedDirty ||
                          renameDraft.trim().length < 2 ||
                          renameDraft.trim() === selectedProfile.label
                        }
                        className="btn-secondary shrink-0 disabled:opacity-50"
                      >
                        Guardar nombre
                      </button>
                    </div>
                  </form>
                  {selectedBuiltIn ? (
                    <p className="text-xs text-slate-500">
                      Los perfiles del sistema no se pueden desactivar ni
                      eliminar.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row">
                      <button
                        type="button"
                        disabled={busy || selectedDirty}
                        onClick={() => roleAction('toggle')}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Power className="h-4 w-4" aria-hidden />
                        {selectedActive
                          ? 'Desactivar perfil'
                          : 'Activar perfil'}
                      </button>
                      <button
                        type="button"
                        disabled={busy || selectedDirty}
                        onClick={() => roleAction('delete')}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Eliminar perfil
                      </button>
                    </div>
                  )}
                </SettingsDetails>
              </section>
            )}
          </div>
        )
      )}
    </main>
  )
}
