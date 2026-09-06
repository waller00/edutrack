'use client'

import { useCallback, useEffect, useState } from 'react'
import { ListChecks, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import type { ActivityType } from '@/lib/academic-config/types'

type Props = { onError: (message: string) => void }

export default function ActivityTypesTab({ onError }: Props) {
  const [types, setTypes] = useState<ActivityType[]>([])
  const [loading, setLoading] = useState(true)

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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
