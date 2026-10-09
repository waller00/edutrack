'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookLock, Loader2, Pencil, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import ScaleFormModal, { scalePayload } from './ScaleFormModal'
import type { ScaleDraft } from './scale-draft'
import UsageNote from './UsageNote'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import CatalogFilters, {
  matchesCatalog,
  type CatalogStatus,
} from './CatalogFilters'
import {
  formatHundredths,
  formatRange,
} from '@/lib/academic-config/grade-value'
import {
  levelAccessibleText,
  levelStyle,
} from '@/lib/academic-config/level-tokens'
import type { GradingScale, ScaleLevel } from '@/lib/academic-config/types'

type Props = { onError: (message: string) => void }

function LevelBadge({ level }: { level: ScaleLevel }) {
  const style = levelStyle(level)
  return (
    // El símbolo y la etiqueta viajan siempre con el color: RNF 7.2 prohíbe que el nivel
    // se distinga sólo por el fondo.
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${style.badgeClass}`}
      title={levelAccessibleText(level)}
    >
      <span aria-hidden>{style.symbol}</span>
      {level.label}
    </span>
  )
}

function LevelRow({
  level,
  decimals,
}: {
  level: ScaleLevel
  decimals: number
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
      <LevelBadge level={level} />
      <span className="font-mono text-xs text-gray-600">
        {formatRange(
          level.minValueHundredths,
          level.maxValueHundredths,
          decimals,
        )}
      </span>
      {level.isPassing && (
        <span className="text-xs text-emerald-700">Aprueba</span>
      )}
      {level.isAlert && (
        <span className="text-xs text-red-700">Cuenta como alerta</span>
      )}
      {level.descriptor && (
        <p className="w-full text-xs text-gray-500">{level.descriptor}</p>
      )}
    </li>
  )
}

function ScaleCard({
  scale,
  onEdit,
  onDeactivate,
}: {
  scale: GradingScale
  onEdit: () => void
  onDeactivate: () => void
}) {
  return (
    <article className={`rounded-xl border border-gray-200 bg-white p-4`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{scale.name}</h3>
          <p
            className={`mt-1 text-xs ${scale.isActive ? 'text-emerald-700' : 'text-slate-500'}`}
          >
            {scale.isActive ? 'Activa' : 'Inactiva'} · {scale.levels.length}{' '}
            tramos
          </p>
        </div>
        <div className="text-right text-xs text-gray-600">
          <p>{scale.kind === 'NUMERIC' ? 'Numérica' : 'Ordinal'}</p>
          <p>
            {formatHundredths(scale.minValueHundredths, scale.decimals)} –{' '}
            {formatHundredths(scale.maxValueHundredths, scale.decimals)}
            {scale.decimals > 0 &&
              ` · ${scale.decimals} decimal${scale.decimals > 1 ? 'es' : ''}`}
          </p>
        </div>
      </header>

      {scale.gradebookRole && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-sky-800">
          <BookLock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            La libreta la usa para {scale.gradebookRole}: no se puede
            desactivar.
            {!scale.isActive &&
              ' Quedó desactivada de antes: editala para activarla.'}
          </span>
        </p>
      )}

      {scale.gaps.length > 0 && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span aria-hidden>▲ </span>
          Sin cubrir:{' '}
          {scale.gaps
            .map((gap) =>
              formatRange(gap.fromHundredths, gap.toHundredths, scale.decimals),
            )
            .join(', ')}
          . Una calificación en ese tramo no va a mostrar descriptor.
        </p>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${scale.name}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 hover:underline"
        >
          <Pencil className="h-4 w-4" aria-hidden />
          Editar
        </button>
      </div>
      <div className="mt-4">
        <SettingsDetails
          title={`Ver tramos de ${scale.name}`}
          description="Rangos, descriptores y condiciones de aprobación."
        >
          <p className="text-xs text-slate-500">
            Código: <span className="font-mono">{scale.code}</span>
          </p>
          {scale.description && (
            <p className="text-sm text-slate-600">{scale.description}</p>
          )}
          <ul className="divide-y divide-slate-100">
            {scale.levels.map((level) => (
              <LevelRow
                key={level.id}
                level={level}
                decimals={scale.decimals}
              />
            ))}
          </ul>
          <UsageNote
            items={[
              {
                count: scale.usage.assessments,
                one: 'evaluación',
                many: 'evaluaciones',
              },
            ]}
          />
          {scale.isActive && !scale.gradebookRole && (
            <button
              type="button"
              onClick={onDeactivate}
              className="text-sm text-red-600 hover:underline"
            >
              Desactivar
            </button>
          )}
        </SettingsDetails>
      </div>
    </article>
  )
}

export default function ScalesTab({ onError }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CatalogStatus>('active')
  const [scales, setScales] = useState<GradingScale[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ scale: GradingScale | null } | null>(
    null,
  )
  const [deactivating, setDeactivating] = useState<GradingScale | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: GradingScale[] }>(
        '/admin/academic-config/scales?includeInactive=true',
      )
      setScales(res.data)
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar las escalas',
      )
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  async function save(draft: ScaleDraft) {
    const target = editing?.scale ?? null
    setSaving(true)
    setFormError(null)
    try {
      await api(
        target
          ? `/admin/academic-config/scales/${target.id}`
          : '/admin/academic-config/scales',
        {
          method: target ? 'PATCH' : 'POST',
          body: JSON.stringify(scalePayload(draft, target !== null)),
        },
      )
      setEditing(null)
      await load()
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'No se pudo guardar la escala',
      )
    } finally {
      setSaving(false)
    }
  }

  async function deactivate() {
    if (!deactivating) return
    setSaving(true)
    try {
      await api(`/admin/academic-config/scales/${deactivating.id}`, {
        method: 'DELETE',
      })
      setDeactivating(null)
      await load()
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudo desactivar la escala',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando escalas…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Escalas de calificación
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Rangos y descriptores disponibles para todas las libretas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError(null)
            setEditing({ scale: null })
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nueva escala
        </button>
      </div>
      <CatalogFilters
        items={scales}
        search={search}
        status={status}
        onSearch={setSearch}
        onStatus={setStatus}
        label="Buscar escala"
      />

      {scales.filter((scale) => matchesCatalog(scale, search, status))
        .length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          {scales.length
            ? 'No hay escalas que coincidan con los filtros.'
            : 'No hay escalas cargadas. Creá una con Nueva escala.'}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {scales
            .filter((scale) => matchesCatalog(scale, search, status))
            .map((scale) => (
              <ScaleCard
                key={scale.id}
                scale={scale}
                onEdit={() => {
                  setFormError(null)
                  setEditing({ scale })
                }}
                onDeactivate={() => setDeactivating(scale)}
              />
            ))}
        </div>
      )}

      <SettingsDetails title="Cómo se usan las escalas">
        <p className="text-sm text-slate-600">
          Cada tramo aporta el descriptor de la calificación e indica si el
          resultado aprueba o cuenta como alerta.
        </p>
        <p className="text-sm text-slate-600">
          Al editar tramos se vuelven a clasificar las notas existentes. Las
          escalas que usa la libreta para C, R o conducta deben permanecer
          activas.
        </p>
      </SettingsDetails>

      {editing && (
        <ScaleFormModal
          scale={editing.scale}
          saving={saving}
          error={formError}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Desactivar ${deactivating.name}`}
          message="Deja de ofrecerse al crear evaluaciones. Las evaluaciones que ya la usan siguen calificándose con ella, y podés volver a activarla."
          confirmLabel="Desactivar"
          pending={saving}
          onConfirm={deactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </div>
  )
}
