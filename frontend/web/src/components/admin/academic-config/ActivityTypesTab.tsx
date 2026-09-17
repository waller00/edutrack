'use client'

import { useCallback, useEffect, useState } from 'react'
import { ListChecks, Loader2, Pencil, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import ActivityTypeFormModal, { activityTypePayload, type ActivityTypeDraft } from './ActivityTypeFormModal'
import UsageNote from './UsageNote'
import type { ActivityType } from '@/lib/academic-config/types'

type Props = { onError: (message: string) => void }

export default function ActivityTypesTab({ onError }: Props) {
  const [types, setTypes] = useState<ActivityType[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ type: ActivityType | null } | null>(null)
  const [deactivating, setDeactivating] = useState<ActivityType | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: ActivityType[] }>('/admin/academic-config/activity-types?includeInactive=true')
      setTypes(res.data)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudieron cargar los tipos de actividad')
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
        target ? `/admin/academic-config/activity-types/${target.id}` : '/admin/academic-config/activity-types',
        { method: target ? 'PATCH' : 'POST', body: JSON.stringify(activityTypePayload(draft, target !== null)) },
      )
      setEditing(null)
      await load()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo guardar el tipo de actividad')
    } finally {
      setSaving(false)
    }
  }

  async function deactivate() {
    if (!deactivating) return
    setSaving(true)
    try {
      await api(`/admin/academic-config/activity-types/${deactivating.id}`, { method: 'DELETE' })
      setDeactivating(null)
      await load()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo desactivar el tipo de actividad')
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
      <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        Catálogo institucional disponible para todas las libretas. Cada docente puede además crear los
        suyos, que sólo ve él y no se listan acá.
      </p>

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

      {types.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          No hay tipos cargados. Corré <code>npm run seed:academic-config</code>.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((type) => (
            <li
              key={type.id}
              className={`rounded-lg border border-gray-200 bg-white px-3 py-2 ${type.isActive ? '' : 'opacity-55'}`}
            >
              <p className="text-sm font-medium text-gray-900">{type.name}</p>
              <p className="font-mono text-xs text-gray-500">{type.code}</p>
              {!type.isActive && <p className="mt-1 text-xs text-gray-500">Inactivo</p>}
              {type.description && <p className="mt-1 text-xs text-gray-600">{type.description}</p>}
              <UsageNote items={[{ count: type.usage.assessments, one: 'evaluación', many: 'evaluaciones' }]} />
              <p className="mt-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null)
                    setEditing({ type })
                  }}
                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                  Editar
                </button>
                {type.isActive && (
                  <button type="button" onClick={() => setDeactivating(type)} className="ml-3 text-red-600 hover:underline">
                    Desactivar
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

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
