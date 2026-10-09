'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import PeriodFormModal, {
  periodPayload,
  type PeriodDraft,
} from './PeriodFormModal'
import UsageNote from './UsageNote'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import CatalogFilters, {
  matchesCatalog,
  type CatalogStatus,
} from './CatalogFilters'
import ScopedCycleNote from './ScopedCycleNote'
import {
  LEVEL_LABELS,
  PERIOD_KIND_SHORT,
  type AcademicLevel,
  type AcademicPeriod,
} from '@/lib/academic-config/types'

const LEVELS: AcademicLevel[] = ['EBI', 'EMS']

type Props = { onError: (message: string) => void }

function formatDay(ymd: string | null): string {
  if (!ymd) return '—'
  const [year, month, day] = ymd.split('-')
  return `${day}/${month}/${year}`
}

function PeriodCard({
  period,
  onEdit,
  onDeactivate,
}: {
  period: AcademicPeriod
  onEdit: () => void
  onDeactivate: () => void
}) {
  const required = [
    ...(period.requiresGeneralGrade ? ['Calificación (C)'] : []),
    ...(period.isMeeting && period.requiresGeneralGrade ? ['Reunión (R)'] : []),
    ...(period.requiresConceptualJudgement
      ? [period.judgementLabel || 'Juicio conceptual']
      : []),
  ]
  return (
    <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {period.name}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {PERIOD_KIND_SHORT[period.kind ?? 'TRAMO']}
            {period.isMeeting && ' · Con reunión'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs ${period.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
        >
          {period.isActive ? 'Activo' : 'Inactivo'}
        </span>
      </header>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Inicio y fin</dt>
          <dd className="mt-1 text-sm text-slate-700">
            {period.startsOn && period.endsOn
              ? `${formatDay(period.startsOn)} – ${formatDay(period.endsOn)}`
              : period.startsOn
                ? `Desde ${formatDay(period.startsOn)}`
                : period.endsOn
                  ? `Hasta ${formatDay(period.endsOn)}`
                  : 'Sin fechas definidas'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Cierre de libreta</dt>
          <dd className="mt-1 text-sm text-slate-700">
            {period.closesOn
              ? formatDay(period.closesOn)
              : 'Sin fecha de cierre'}
          </dd>
        </div>
      </dl>
      <div>
        <p className="mb-1 text-xs text-slate-500">Obligatorio al cerrar</p>
        <div className="flex flex-wrap gap-1">
          {required.length ? (
            required.map((label) => (
              <span
                key={label}
                className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700"
              >
                {label}
              </span>
            ))
          ) : (
            <p className="text-xs text-slate-500">
              Sin requisitos obligatorios.
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Editar ${period.name}`}
        className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700 hover:underline"
      >
        <Pencil className="h-4 w-4" aria-hidden />
        Editar
      </button>
      <SettingsDetails title={`Detalles de ${period.name}`}>
        <p className="text-xs text-slate-500">
          Código: <span className="font-mono">{period.code}</span> · Orden:{' '}
          {period.sortOrder}
        </p>
        <UsageNote
          items={[
            {
              count: period.usage.assessments,
              one: 'evaluación',
              many: 'evaluaciones',
            },
            {
              count: period.usage.closedGradeBooks,
              one: 'libreta cerrada',
              many: 'libretas cerradas',
            },
          ]}
        />
        {period.isActive && (
          <button
            type="button"
            onClick={onDeactivate}
            className="text-sm text-red-600 hover:underline"
          >
            Desactivar
          </button>
        )}
      </SettingsDetails>
    </article>
  )
}

type Editing = { period: AcademicPeriod | null; level: AcademicLevel }

/** El mensaje dice qué pasa de verdad: desactivar no borra nada, deja de ofrecerse al calificar. */
export function deactivateMessage(period: AcademicPeriod): string {
  const base =
    'Deja de ofrecerse al crear evaluaciones y al cerrar libretas. Nada de lo ya cargado se borra, y podés volver a activarlo.'
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
  const schoolYearsLoading = schoolYear?.loading ?? false
  const loadRequest = useRef(0)
  const [level, setLevel] = useState<AcademicLevel>('EBI')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<CatalogStatus>('active')
  const [periods, setPeriods] = useState<AcademicPeriod[]>([])
  const [schoolYearId, setSchoolYearId] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deactivating, setDeactivating] = useState<AcademicPeriod | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const request = ++loadRequest.current
    setLoading(true)
    if (schoolYearsLoading) return
    try {
      const res = await api<{ data: AcademicPeriod[]; schoolYearId: string }>(
        withSchoolYear(
          '/admin/academic-config/periods?includeInactive=true',
          schoolYearQuery,
        ),
      )
      if (request === loadRequest.current) {
        setPeriods(res.data)
        setSchoolYearId(res.schoolYearId)
      }
    } catch (error) {
      if (request !== loadRequest.current) return
      setPeriods([])
      setSchoolYearId('')
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudieron cargar los períodos',
      )
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }, [schoolYearQuery, schoolYearsLoading, onError])

  async function save(draft: PeriodDraft) {
    const target = editing?.period
    setSaving(true)
    setFormError(null)
    try {
      await api(
        target
          ? `/admin/academic-config/periods/${target.id}`
          : '/admin/academic-config/periods',
        {
          method: target ? 'PATCH' : 'POST',
          body: JSON.stringify(
            periodPayload(
              draft,
              target !== null && target !== undefined,
              schoolYearId,
            ),
          ),
        },
      )
      setEditing(null)
      await load()
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar el período',
      )
    } finally {
      setSaving(false)
    }
  }

  async function deactivate() {
    if (!deactivating) return
    setSaving(true)
    try {
      await api(`/admin/academic-config/periods/${deactivating.id}`, {
        method: 'DELETE',
      })
      setDeactivating(null)
      await load()
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudo desactivar el período',
      )
    } finally {
      setSaving(false)
    }
  }

  const cancelPendingLoad = useCallback(() => {
    loadRequest.current++
  }, [])
  useEffect(() => {
    setEditing(null)
    setDeactivating(null)
    void load()
    return cancelPendingLoad
  }, [load, cancelPendingLoad])

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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Calendario de evaluación
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Fechas y requisitos para cerrar cada período.
          </p>
          <div className="mt-2">
            <ScopedCycleNote />
          </div>
        </div>
        <button
          type="button"
          disabled={!schoolYearId}
          onClick={() => {
            setFormError(null)
            setEditing({ period: null, level })
          }}
          className="btn-primary inline-flex items-center gap-2 text-sm"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nuevo período en {level}
        </button>
      </header>
      <div
        role="group"
        aria-label="Nivel educativo"
        className="flex flex-wrap gap-2"
      >
        {LEVELS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={level === item}
            onClick={() => {
              setLevel(item)
              setSearch('')
            }}
            className={`rounded-lg border px-4 py-2 text-sm ${level === item ? 'border-emerald-200 bg-emerald-50 font-medium text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}
          >
            {item}{' '}
            <span className="text-xs">
              ({periods.filter((period) => period.level === item).length})
            </span>
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{LEVEL_LABELS[level]}</p>
      <CatalogFilters
        items={periods.filter((period) => period.level === level)}
        search={search}
        status={status}
        onSearch={setSearch}
        onStatus={setStatus}
        label="Buscar período"
      />
      {periods.some(
        (period) =>
          period.level === level && matchesCatalog(period, search, status),
      ) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {periods
            .filter(
              (period) =>
                period.level === level &&
                matchesCatalog(period, search, status),
            )
            .map((period) => (
              <PeriodCard
                key={period.id}
                period={period}
                onEdit={() => {
                  setFormError(null)
                  setEditing({ period, level })
                }}
                onDeactivate={() => setDeactivating(period)}
              />
            ))}
        </div>
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {periods.some((period) => period.level === level)
            ? 'No hay períodos que coincidan con los filtros.'
            : 'Este nivel no tiene períodos en el ciclo seleccionado. Creá uno con Nuevo período.'}
        </p>
      )}
      <SettingsDetails title="Cómo funcionan los períodos">
        <p className="text-sm text-slate-600">
          EBI y EMS tienen calendarios distintos. Los requisitos indicados deben
          completarse para poder cerrar la libreta.
        </p>
        <p className="text-sm text-slate-600">
          Los períodos inactivos conservan lo ya cargado. Podés volver a
          activarlos desde Editar.
        </p>
      </SettingsDetails>

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
