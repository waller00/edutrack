'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Loader2, Pencil, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import PeriodFormModal, { periodPayload, type PeriodDraft } from './PeriodFormModal'
import UsageNote from './UsageNote'
import { LEVEL_LABELS, LEVEL_SHORT_LABELS, type AcademicLevel, type AcademicPeriod } from '@/lib/academic-config/types'

const LEVELS: AcademicLevel[] = ['EBI', 'EMS']

type Props = { onError: (message: string) => void }

function formatDay(ymd: string | null): string {
  if (!ymd) return '—'
  const [year, month, day] = ymd.split('-')
  return `${day}/${month}/${year}`
}

function RequirementBadge({ on, label }: { on: boolean; label: string }) {
  // Texto además del color: el estado no puede leerse sólo por el fondo (RNF 7.2).
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
        on ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-500'
      }`}
    >
      <span aria-hidden>{on ? '✓' : '—'}</span>
      {label}
    </span>
  )
}

function PeriodRow({
  period,
  onEdit,
  onDeactivate,
}: {
  period: AcademicPeriod
  onEdit: () => void
  onDeactivate: () => void
}) {
  return (
    <tr className={period.isActive ? '' : 'opacity-55'}>
      <td className="px-3 py-2">
        <div className="font-medium text-gray-900">{period.name}</div>
        <div className="font-mono text-xs text-gray-500">{period.code}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
        {formatDay(period.startsOn)} – {formatDay(period.endsOn)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatDay(period.closesOn)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <RequirementBadge on={period.requiresGeneralGrade} label="Calificación" />
          <RequirementBadge on={period.requiresConceptualJudgement} label="Juicio conceptual" />
        </div>
      </td>
      <td className="px-3 py-2 text-sm">
        {period.isActive ? (
          <span className="text-gray-600">Activo</span>
        ) : (
          <span className="text-gray-500">Inactivo</span>
        )}
        <UsageNote
          items={[
            { count: period.usage.assessments, one: 'evaluación', many: 'evaluaciones' },
            { count: period.usage.closedGradeBooks, one: 'libreta cerrada', many: 'libretas cerradas' },
          ]}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-sm">
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Editar
        </button>
        {period.isActive && (
          <button type="button" onClick={onDeactivate} className="ml-3 text-red-600 hover:underline">
            Desactivar
          </button>
        )}
      </td>
    </tr>
  )
}

function LevelSection({
  level,
  periods,
  onCreate,
  onEdit,
  onDeactivate,
}: {
  level: AcademicLevel
  periods: AcademicPeriod[]
  onCreate: () => void
  onEdit: (period: AcademicPeriod) => void
  onDeactivate: (period: AcademicPeriod) => void
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="flex flex-wrap items-baseline gap-2 border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{LEVEL_SHORT_LABELS[level]}</h3>
        <p className="text-xs text-gray-500">{LEVEL_LABELS[level]}</p>
        <button
          type="button"
          onClick={onCreate}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Nuevo período en {LEVEL_SHORT_LABELS[level]}
        </button>
      </header>

      {periods.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          Este nivel no tiene períodos en el ciclo seleccionado. Corré <code>npm run seed:academic-config</code> para
          cargar los reglamentarios.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Período</th>
                <th scope="col" className="px-3 py-2 font-medium">Ventana</th>
                <th scope="col" className="px-3 py-2 font-medium">Cierre</th>
                <th scope="col" className="px-3 py-2 font-medium">Obligatorio al cerrar</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                <th scope="col" className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {periods.map((period) => (
                <PeriodRow
                  key={period.id}
                  period={period}
                  onEdit={() => onEdit(period)}
                  onDeactivate={() => onDeactivate(period)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type Editing = { period: AcademicPeriod | null; level: AcademicLevel }

/** El mensaje dice qué pasa de verdad: desactivar no borra nada, deja de ofrecerse al calificar. */
export function deactivateMessage(period: AcademicPeriod): string {
  const base = 'Deja de ofrecerse al crear evaluaciones y al cerrar libretas. Nada de lo ya cargado se borra, y podés volver a activarlo.'
  if (period.usage.closedGradeBooks > 0) {
    return `${base} Cuidado: ${period.usage.closedGradeBooks} libreta(s) ya cerraron este período y se siguen consultando.`
  }
  return base
}

export default function PeriodsTab({ onError }: Props) {
  const schoolYear = useOptionalAdminSchoolYear()
  // `schoolYearScopedQuery` y no `schoolYearQuery`: un período pertenece a UN ciclo, así que
  // "ver todos los ciclos" no tiene sentido acá y mezclaría calendarios de años distintos.
  const schoolYearQuery = schoolYear?.schoolYearScopedQuery ?? ''
  const [periods, setPeriods] = useState<AcademicPeriod[]>([])
  const [schoolYearId, setSchoolYearId] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deactivating, setDeactivating] = useState<AcademicPeriod | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: AcademicPeriod[]; schoolYearId: string }>(
        withSchoolYear('/admin/academic-config/periods?includeInactive=true', schoolYearQuery),
      )
      setPeriods(res.data)
      setSchoolYearId(res.schoolYearId)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudieron cargar los períodos')
    } finally {
      setLoading(false)
    }
  }, [schoolYearQuery, onError])

  async function save(draft: PeriodDraft) {
    const target = editing?.period
    setSaving(true)
    setFormError(null)
    try {
      await api(
        target ? `/admin/academic-config/periods/${target.id}` : '/admin/academic-config/periods',
        {
          method: target ? 'PATCH' : 'POST',
          body: JSON.stringify(periodPayload(draft, target !== null && target !== undefined, schoolYearId)),
        },
      )
      setEditing(null)
      await load()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No se pudo guardar el período')
    } finally {
      setSaving(false)
    }
  }

  async function deactivate() {
    if (!deactivating) return
    setSaving(true)
    try {
      await api(`/admin/academic-config/periods/${deactivating.id}`, { method: 'DELETE' })
      setDeactivating(null)
      await load()
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo desactivar el período')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando períodos…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        Los períodos se administran por ciclo lectivo y nivel: EBI y EMS tienen calendarios distintos.
        Un período con calificación o juicio conceptual obligatorio no deja cerrar la libreta hasta completarlos.
      </p>

      {LEVELS.map((level) => (
        <LevelSection
          key={level}
          level={level}
          periods={periods.filter((p) => p.level === level)}
          onCreate={() => {
            setFormError(null)
            setEditing({ period: null, level })
          }}
          onEdit={(period) => {
            setFormError(null)
            setEditing({ period, level })
          }}
          onDeactivate={setDeactivating}
        />
      ))}

      {editing && (
        <PeriodFormModal
          period={editing.period}
          level={editing.level}
          saving={saving}
          error={formError}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Desactivar ${deactivating.name}`}
          message={deactivateMessage(deactivating)}
          confirmLabel="Desactivar"
          pending={saving}
          onConfirm={deactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </div>
  )
}
