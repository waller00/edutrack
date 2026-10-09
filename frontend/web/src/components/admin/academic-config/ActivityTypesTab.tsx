'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import ActivityTypeFormModal, {
  activityTypePayload,
  type ActivityTypeDraft,
} from './ActivityTypeFormModal'
import UsageNote from './UsageNote'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import CatalogFilters, {
  matchesCatalog,
  type CatalogStatus,
} from './CatalogFilters'
import {
  ACTIVITY_CATEGORY_OPTIONS,
  type ActivityType,
} from '@/lib/academic-config/types'

type Props = { onError: (message: string) => void }

export default function ActivityTypesTab({ onError }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CatalogStatus>('active')
  const [types, setTypes] = useState<ActivityType[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ type: ActivityType | null } | null>(
    null,
  )
  const [deactivating, setDeactivating] = useState<ActivityType | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: ActivityType[] }>(
        '/admin/academic-config/activity-types?includeInactive=true',
      )
      setTypes(res.data)
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar los tipos de actividad',
      )
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  async function save(draft: ActivityTypeDraft) {
    const target = editing?.type ?? null
    setSaving(true)
    setFormError(null)
    try {
      await api(
        target
          ? `/admin/academic-config/activity-types/${target.id}`
          : '/admin/academic-config/activity-types',
        {
          method: target ? 'PATCH' : 'POST',
          body: JSON.stringify(activityTypePayload(draft, target !== null)),
        },
      )
      setEditing(null)
      await load()
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar el tipo de actividad',
      )
    } finally {
      setSaving(false)
    }
  }

  async function deactivate() {
    if (!deactivating) return
    setSaving(true)
    try {
      await api(`/admin/academic-config/activity-types/${deactivating.id}`, {
        method: 'DELETE',
      })
      setDeactivating(null)
      await load()
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudo desactivar el tipo de actividad',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando tipos de actividad…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Tipos de actividad
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Catálogo institucional para registrar evaluaciones.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError(null)
            setEditing({ type: null })
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nuevo tipo de actividad
        </button>
      </div>
      <CatalogFilters
        items={types}
        search={search}
        status={status}
        onSearch={setSearch}
        onStatus={setStatus}
        label="Buscar tipo de actividad"
      />

      {types.filter((type) => matchesCatalog(type, search, status)).length ===
      0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          {types.length
            ? 'No hay tipos de actividad que coincidan con los filtros.'
            : 'No hay tipos cargados. Creá uno con Nuevo tipo de actividad.'}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {types
            .filter((type) => matchesCatalog(type, search, status))
            .map((type) => (
              <li
                key={type.id}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <p className="text-sm font-medium text-gray-900">{type.name}</p>

                <p className="text-xs text-gray-600">
                  Columna:{' '}
                  {ACTIVITY_CATEGORY_OPTIONS.find(
                    (o) => o.code === type.category,
                  )?.label ?? 'Otras'}
                </p>
                <p
                  className={`text-xs ${type.isActive ? 'text-emerald-700' : 'text-slate-500'}`}
                >
                  {type.isActive ? 'Activo' : 'Inactivo'}
                </p>
                <p className="mt-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setFormError(null)
                      setEditing({ type })
                    }}
                    aria-label={`Editar ${type.name}`}
                    className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 hover:underline"
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    Editar
                  </button>
                </p>
                <SettingsDetails title={`Detalles de ${type.name}`}>
                  <p className="text-xs text-slate-500">
                    Código: <span className="font-mono">{type.code}</span>
                  </p>
                  {type.description && (
                    <p className="text-sm text-slate-600">{type.description}</p>
                  )}
                  <UsageNote
                    items={[
                      {
                        count: type.usage.assessments,
                        one: 'evaluación',
                        many: 'evaluaciones',
                      },
                    ]}
                  />
                  {type.isActive && (
                    <button
                      type="button"
                      onClick={() => setDeactivating(type)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Desactivar
                    </button>
                  )}
                </SettingsDetails>
              </li>
            ))}
        </ul>
      )}

      <SettingsDetails title="Cómo se usan los tipos de actividad">
        <p className="text-sm text-slate-600">
          Estos tipos están disponibles para todas las libretas. Cada docente
          también puede crear tipos personales que solo él ve.
        </p>
        <p className="text-sm text-slate-600">
          La columna indica dónde aparece la actividad en la planilla.
          Desactivar un tipo conserva las evaluaciones que ya lo usan.
        </p>
      </SettingsDetails>

      {editing && (
        <ActivityTypeFormModal
          type={editing.type}
          saving={saving}
          error={formError}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Desactivar ${deactivating.name}`}
          message="Deja de ofrecerse al crear evaluaciones. Las evaluaciones que ya lo usan conservan su tipo, y podés volver a activarlo."
          confirmLabel="Desactivar"
          pending={saving}
          onConfirm={deactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </div>
  )
}
