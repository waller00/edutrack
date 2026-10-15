'use client'

import { api } from '@/lib/api/client'
import { auditMetadataDisplay } from '@/lib/admin/audit-detail-es'
import {
  countActiveAuditFilters,
  getAuditActionBadgeClass,
  type AuditFilters,
} from '@/lib/admin/audit-display'
import { formatDateTimeInUruguay } from '@/lib/forms/datetime-uy'
import DateRangePicker from '@/components/forms/DateRangePicker'
import SettingsDetails from './settings/SettingsDetails'
import AuditPersonFilter, { type AuditPerson } from './AuditPersonFilter'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  RefreshCw,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import ModuleHeader from '@/components/common/ModuleHeader'

type AuditRow = {
  id: string
  occurredAt: string
  action: string
  actionLabel: string
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  actorIp: string | null
  userAgent: string | null
  source: string
  entityType: string | null
  entityId: string | null
  metadata: unknown
}
type ActionCat = { code: string; label: string }
type ListResponse = {
  total: number
  page: number
  pageSize: number
  actionCatalog: ActionCat[]
  data: AuditRow[]
}

const EMPTY_FILTERS: AuditFilters = {
  action: '',
  actorUserId: '',
  from: '',
  to: '',
}
const PAGE_SIZE = 25
const ENTITY_LABELS: Record<string, string> = {
  User: 'Usuario',
  Event: 'Agenda / clase',
  MedicalLeave: 'Licencia',
  SystemSettings: 'Configuración del sistema',
  OrgRole: 'Perfil',
  GradeBook: 'Libreta',
  GradingScale: 'Escala de calificación',
  AcademicPeriod: 'Período académico',
  ActivityType: 'Tipo de actividad',
  AcademicAlertRule: 'Regla de alerta',
  Attendance: 'Asistencia',
  Student: 'Estudiante',
  Substitution: 'Suplencia',
}

function formatWhen(iso: string) {
  try {
    return formatDateTimeInUruguay(iso, { seconds: true })
  } catch {
    return iso
  }
}

function actorLabel(row: AuditRow) {
  return row.actorName || row.actorEmail || 'Usuario no identificado'
}

function AuditActivity({
  row,
  onFilterPerson,
}: {
  row: AuditRow
  onFilterPerson: (row: AuditRow) => void
}) {
  const detail = auditMetadataDisplay(row.action, row.metadata)
  const when = formatWhen(row.occurredAt)
  const who = actorLabel(row)
  const technicalFields = [
    ['Código de acción', row.action],
    ['ID del registro', row.id],
    ['Origen', row.source],
    ['ID de usuario', row.actorUserId],
    ['ID del elemento', row.entityId],
    ['Navegador / dispositivo', row.userAgent],
  ]
  return (
    <details className="group/audit bg-white open:bg-slate-50/40">
      <summary
        aria-label={`Ver detalle de ${row.actionLabel}, ${who}, ${when}`}
        className="flex cursor-pointer list-none items-start gap-3 p-4 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 [&::-webkit-details-marker]:hidden"
      >
        <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,0.6fr)_160px] md:items-center md:gap-4">
          <div className="min-w-0">
            <span
              className={`inline-flex max-w-full rounded-lg px-2.5 py-1 text-sm font-medium ${getAuditActionBadgeClass(row.action)}`}
            >
              {row.actionLabel || row.action}
            </span>
          </div>
          <span className="min-w-0 break-words text-sm text-slate-700">
            {(row.actorName || row.actorEmail) && (
              <span className="text-xs text-slate-500 md:sr-only">
                Usuario:{' '}
              </span>
            )}
            {who}
          </span>
          <span className="min-w-0 break-all font-mono text-xs text-slate-600">
            <span className="font-sans text-slate-500 md:sr-only">IP: </span>
            {row.actorIp || 'No registrada'}
          </span>
          <time
            dateTime={row.occurredAt}
            className="text-xs tabular-nums text-slate-500"
          >
            {when}
          </time>
        </div>
        <ChevronDown
          className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition group-open/audit:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              Detalle de la actividad
            </h3>
            {detail.lines.length ? (
              <ul className="list-disc space-y-1.5 pl-4 text-sm text-slate-700 marker:text-emerald-600">
                {detail.lines.map((line, index) => (
                  <li key={index} className="break-words">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">
                Sin información adicional.
              </p>
            )}
            {row.entityType && (
              <p className="mt-3 text-xs text-slate-500">
                Elemento: {ENTITY_LABELS[row.entityType] || row.entityType}
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              Persona que realizó la acción
            </h3>
            <p className="break-words text-sm text-slate-700">{who}</p>
            {row.actorName && row.actorEmail && (
              <p className="mt-1 break-all text-xs text-slate-500">
                {row.actorEmail}
              </p>
            )}
            {row.actorUserId && (
              <button
                type="button"
                onClick={() => onFilterPerson(row)}
                className="mt-2 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-emerald-700 hover:underline"
              >
                <UserRound className="h-4 w-4 shrink-0" aria-hidden />
                Ver actividad de esta persona
              </button>
            )}
          </div>
        </div>
        <SettingsDetails
          title="Datos técnicos"
          description="Identificadores, conexión y datos originales del registro."
        >
          <dl className="grid gap-3 sm:grid-cols-2">
            {technicalFields
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs font-medium text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs text-slate-700">
                    {value}
                  </dd>
                </div>
              ))}
          </dl>
          {detail.technicalJson && (
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">
                Datos originales (JSON)
              </p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-600">
                {detail.technicalJson}
              </pre>
            </div>
          )}
        </SettingsDetails>
      </div>
    </details>
  )
}

export default function AdminAuditPanel({
  compact = false,
}: { compact?: boolean } = {}) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [catalog, setCatalog] = useState<ActionCat[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [person, setPerson] = useState<AuditPerson | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    async function load() {
      try {
        const q = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (filters.action) q.set('action', filters.action)
        if (filters.actorUserId) q.set('actorUserId', filters.actorUserId)
        // El día civil de Uruguay empieza a las 03:00 UTC y termina al día siguiente.
        if (filters.from)
          q.set(
            'from',
            new Date(`${filters.from}T00:00:00.000-03:00`).toISOString(),
          )
        if (filters.to)
          q.set(
            'to',
            new Date(`${filters.to}T23:59:59.999-03:00`).toISOString(),
          )
        const data = await api<ListResponse>(`/admin/audit-logs?${q}`)
        if (cancelled) return
        const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
        setRows(data.data)
        setCatalog(data.actionCatalog)
        setTotal(data.total)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el registro de auditoría.',
        )
        setRows([])
        setTotal(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [page, filters, refresh])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const activeFilterCount = countActiveAuditFilters(filters)

  function updateFilters(patch: Partial<AuditFilters>) {
    setPage(1)
    setFilters((current) => ({ ...current, ...patch }))
  }

  function selectPerson(person: AuditPerson | null) {
    setPerson(person)
    updateFilters({ actorUserId: person?.id || '' })
  }

  function clearFilters() {
    setPage(1)
    setFilters(EMPTY_FILTERS)
    setPerson(null)
  }

  function filterPerson(row: AuditRow) {
    if (!row.actorUserId) return
    selectPerson({
      id: row.actorUserId,
      name: actorLabel(row),
      email: row.actorEmail || '',
    })
  }

  return (
    <main
      className={compact ? 'space-y-4' : 'responsive-page max-w-7xl space-y-4'}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {compact ? (
          <div className="flex items-start gap-3">
            <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
              <ClipboardList className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Auditoría de actividades
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Consultá qué pasó, quién realizó la acción y cuándo.
              </p>
            </div>
          </div>
        ) : (
          <ModuleHeader id="audit" />
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => setRefresh((current) => current + 1)}
          className="btn-secondary gap-2 text-sm disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <section
        aria-label="Filtros de auditoría"
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      >
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <label
              htmlFor="audit-action"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Tipo de acción
            </label>
            <select
              id="audit-action"
              className="select-field min-h-11 bg-white text-sm"
              value={filters.action}
              onChange={(event) =>
                updateFilters({ action: event.target.value })
              }
            >
              <option value="">Todas las acciones</option>
              {catalog.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <AuditPersonFilter value={person} onChange={selectPerson} />
          <DateRangePicker
            startDate={filters.from}
            endDate={filters.to}
            onChange={({ startDate, endDate }) =>
              updateFilters({ from: startDate, to: endDate })
            }
          />
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:col-span-2 xl:col-span-3 xl:justify-self-end"
            >
              <X className="h-4 w-4" aria-hidden />
              Limpiar filtros
            </button>
          )}
        </div>
        {filters.actorUserId && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <span className="min-w-0 break-words">
              Actividad de:{' '}
              <strong className="font-medium">
                {person?.name || person?.email || 'Usuario específico'}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => selectPerson(null)}
              aria-label="Quitar filtro de usuario"
              className="rounded-md p-2 hover:bg-emerald-100"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setRefresh((current) => current + 1)}
            className="font-semibold underline"
          >
            Reintentar
          </button>
        </div>
      )}

      <section
        aria-label="Movimientos registrados"
        aria-busy={loading}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 p-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Movimientos registrados
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Más recientes primero. Abrí una actividad para ver el detalle.
            </p>
          </div>
          {!loading && !error && (
            <span className="text-xs tabular-nums text-slate-500">
              {total} {total === 1 ? 'registro' : 'registros'}
            </span>
          )}
        </div>
        {loading ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando movimientos…
          </div>
        ) : (
          !error &&
          (rows.length ? (
            <>
              <div
                aria-hidden
                className="hidden gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 md:flex"
              >
                <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,0.6fr)_160px] gap-4 text-xs font-medium text-slate-500">
                  <span>Actividad</span>
                  <span>Usuario</span>
                  <span>Dirección IP</span>
                  <span>Fecha y hora</span>
                </div>
                <span className="w-4" />
              </div>
              <div className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <AuditActivity
                    key={row.id}
                    row={row}
                    onFilterPerson={filterPerson}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-700">
                {activeFilterCount
                  ? 'No hay movimientos que coincidan con los filtros.'
                  : 'Todavía no hay movimientos registrados.'}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 min-h-10 text-sm font-medium text-emerald-700 hover:underline"
                >
                  Quitar filtros y ver todos
                </button>
              )}
            </div>
          ))
        )}
      </section>

      {total > 0 && !loading && !error && (
        <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular-nums">
            Mostrando{' '}
            <span className="font-medium text-slate-900">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}
            </span>{' '}
            de <span className="font-medium text-slate-900">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Anterior
            </button>
            <span className="text-xs tabular-nums">
              Página {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
