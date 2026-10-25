'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ClipboardList, FileText, Loader2, MessageCircle } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { useLibreta } from '@/contexts/LibretaContext'
import { useOptionalMessages } from '@/components/messages/MessagesProvider'
import EndorsementBadge from '@/components/gradebook/EndorsementBadge'
import EndorsementRowDetail from '@/components/admin/gradebook/EndorsementRowDetail'
import {
  ENDORSEMENT_SECTION_LABELS,
  endorsementAbilities,
  formatEndorsementDate,
  type EndorsementHistoryEntry,
  type EndorsementRow,
} from '@/lib/gradebook/endorsements'
import { sectionHref } from '@/lib/libreta/menu'

type Row = EndorsementRow & { reopenReason: string | null; history: EndorsementHistoryEntry[] }

type PeriodRow = {
  periodId: string
  name: string
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  groupReport: string | null
  groupReportUpdatedAt: string | null
  requiresGroupReport: boolean
}

type Planning = { formative: string | null; replanning: string | null; updatedAt: string | null }
type Development = {
  data: Array<{ id: string; date: string; description: string }>
  totals: { hoursTaught: number; hoursNotTaught: number }
}

const CARD = 'rounded-xl border border-gray-200 bg-white p-4'

function excerpt(text: string | null | undefined, max = 220): string {
  const clean = (text ?? '').trim().replace(/\s+/g, ' ')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/**
 * Seguimiento: si el docente dio lo que planificó. Pone la planificación al lado de lo que
 * registró clase a clase, para que Dirección lo compare sin recorrer las dos secciones.
 */
function Seguimiento({ gradeBookId }: { gradeBookId: string }) {
  const [planning, setPlanning] = useState<Planning | null>(null)
  const [development, setDevelopment] = useState<Development | null>(null)

  useEffect(() => {
    api<{ data: Planning }>(`/gradebook/${gradeBookId}/planning`)
      .then((res) => setPlanning(res.data))
      .catch(() => setPlanning({ formative: null, replanning: null, updatedAt: null }))
    api<Development>(`/gradebook/${gradeBookId}/development`)
      .then(setDevelopment)
      .catch(() => setDevelopment({ data: [], totals: { hoursTaught: 0, hoursNotTaught: 0 } }))
  }, [gradeBookId])

  const last = useMemo(
    () => [...(development?.data ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [development],
  )

  return (
    <section className={CARD} aria-labelledby="seguimiento-title">
      <h3 id="seguimiento-title" className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <ClipboardList className="h-4 w-4 text-gray-400" aria-hidden />
        Seguimiento: lo planificado y lo dictado
      </h3>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p className="font-medium text-gray-700">Planificación</p>
          {planning === null ? (
            <p className="text-gray-500">Cargando…</p>
          ) : planning.formative?.trim() ? (
            <>
              <p className="text-gray-700">{excerpt(planning.formative)}</p>
              {planning.replanning?.trim() && (
                <p className="text-gray-600">
                  <span className="font-medium">Replanificación:</span> {excerpt(planning.replanning, 140)}
                </p>
              )}
              {planning.updatedAt && (
                <p className="text-xs text-gray-500">Actualizada el {formatEndorsementDate(planning.updatedAt)}</p>
              )}
            </>
          ) : (
            <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">▲ El docente no cargó la planificación.</p>
          )}
          <Link href={sectionHref(gradeBookId, 'planificacion')} className="text-xs text-emerald-700 hover:underline">
            Ver planificación completa
          </Link>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium text-gray-700">Desarrollo del curso</p>
          {development === null ? (
            <p className="text-gray-500">Cargando…</p>
          ) : development.data.length === 0 ? (
            <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">▲ Todavía no registró ninguna clase.</p>
          ) : (
            <>
              <p className="text-gray-700">
                {development.data.length} clase{development.data.length === 1 ? '' : 's'} registrada
                {development.data.length === 1 ? '' : 's'} · {development.totals.hoursTaught} h dictadas ·{' '}
                {development.totals.hoursNotTaught} h sin dictar
              </p>
              {last && (
                <p className="text-gray-600">
                  <span className="font-medium">Última, {formatEndorsementDate(last.date)}:</span> {excerpt(last.description, 140)}
                </p>
              )}
            </>
          )}
          <Link href={sectionHref(gradeBookId, 'desarrollo')} className="text-xs text-emerald-700 hover:underline">
            Ver desarrollo clase a clase
          </Link>
        </div>
      </div>
    </section>
  )
}

/** Informe general del grupo de cada reunión de boletín, como lo dejó el docente. */
function InformesDelGrupo({ periods }: { periods: PeriodRow[] }) {
  const meetings = periods.filter((p) => p.requiresGroupReport)
  if (meetings.length === 0) return null
  return (
    <section className={CARD} aria-labelledby="informes-title">
      <h3 id="informes-title" className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <FileText className="h-4 w-4 text-gray-400" aria-hidden />
        Informe general del grupo
      </h3>
      <ul className="mt-3 space-y-3">
        {meetings.map((period) => (
          <li key={period.periodId} className="text-sm">
            <p className="font-medium text-gray-700">{period.name}</p>
            {period.groupReport?.trim() ? (
              <>
                <p className="whitespace-pre-wrap text-gray-700">{period.groupReport}</p>
                {period.groupReportUpdatedAt && (
                  <p className="text-xs text-gray-500">Cargado el {formatEndorsementDate(period.groupReportUpdatedAt)}</p>
                )}
              </>
            ) : (
              <p className="text-amber-900">▲ Falta el informe del grupo.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Abre la mensajería 1 a 1 directo en la conversación con el docente de la libreta. Reemplaza al
 * viejo cuadro "Mensajes al docente": lo que se le dice al docente va por el mismo canal que todo
 * lo demás, con su aviso por push.
 */
function WriteToTeacher({ teacher }: { teacher: { id: string; name: string | null } | null | undefined }) {
  const messages = useOptionalMessages()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!teacher || !messages?.enabled) return null

  async function open() {
    if (!teacher) return
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ data: { id: string } }>('/messages/conversations', {
        method: 'POST',
        body: JSON.stringify({ userId: teacher.id }),
      })
      messages?.openDrawer(res.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la conversación')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${CARD} flex flex-wrap items-center gap-3`} aria-labelledby="visado-escribir">
      <div className="min-w-0 flex-1">
        <h3 id="visado-escribir" className="text-sm font-semibold text-gray-900">
          Escribirle al docente
        </h3>
        <p className="text-xs text-gray-500">
          Si falta algo o hay algo mal cargado, escribile a {teacher.name ?? 'el docente'} por mensajes.
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        Escribirle al docente
      </button>
    </section>
  )
}

/**
 * "Visado y seguimiento" de una libreta, para Dirección (y adscripción, que observa).
 *
 * Reúne lo que el director revisa antes de visar: las calificaciones y los juicios de cada reunión
 * cerrada, si el docente dio lo que planificó y si dejó el informe del grupo. No edita nada de la
 * libreta: observa y visa. Lo observado el docente lo ve en "Cierre de períodos"; para escribirle
 * está la mensajería 1 a 1.
 */
export default function VisadoDireccionSection() {
  const { gradeBookId, detail } = useLibreta()
  const me = useOptionalAuth()?.me ?? null
  const abilities = useMemo(() => endorsementAbilities(me), [me])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [periods, setPeriods] = useState<PeriodRow[]>([])
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [endorsements, periodList] = await Promise.all([
        api<{ data: Row[] }>(`/gradebook/${gradeBookId}/endorsements`),
        api<{ data: PeriodRow[] }>(`/gradebook/${gradeBookId}/periods`),
      ])
      setRows(endorsements.data)
      setPeriods(periodList.data)
    } catch (err) {
      setRows([])
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo cargar el visado' })
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  async function afterChange(text: string) {
    setMessage({ kind: 'ok', text })
    await load()
  }

  async function endorse(row: Row) {
    setBusy(true)
    setMessage(null)
    try {
      await api('/admin/gradebook/endorsements', {
        method: 'POST',
        body: JSON.stringify({ gradeBookPeriodId: row.gradeBookPeriodId, section: 'ALL', status: 'ENDORSED' }),
      })
      await afterChange(`Se visó ${row.period.name}. El docente recibió el aviso.`)
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo visar' })
    } finally {
      setBusy(false)
    }
  }

  if (rows === null) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando visado…
      </p>
    )
  }

  // Lo cerrado, y lo reabierto para corregir: tiene que seguir mostrando qué se observó.
  const visible = rows.filter((row) => row.periodStatus === 'CLOSED' || row.history.length > 0)

  return (
    <div className="space-y-4">
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'}`}
        >
          {message.text}
        </p>
      )}

      <section className="space-y-2" aria-labelledby="visado-periodos">
        <h3 id="visado-periodos" className="text-sm font-semibold text-gray-900">
          Reuniones cerradas
        </h3>
        {visible.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
            {detail?.teacher?.name ?? 'El docente'} todavía no cerró ninguna reunión: no hay nada para visar. Igual
            podés revisar el seguimiento y escribirle.
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((row) => (
              <li key={row.gradeBookPeriodId} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <span className="text-sm font-semibold text-gray-900">{row.period.name}</span>
                  <EndorsementBadge status={row.overallStatus} />
                  {row.closedLate && <span className="text-xs text-amber-800">▲ Cerrado fuera de plazo</span>}
                  {abilities.canEndorse && row.overallStatus !== 'ENDORSED' && row.periodStatus === 'CLOSED' && (
                    <button
                      type="button"
                      disabled={busy || !row.canFinalize}
                      title={
                        row.canFinalize
                          ? undefined
                          : `Hay secciones observadas sin corregir: ${row.blockingSections.map((s) => ENDORSEMENT_SECTION_LABELS[s]).join(', ')}`
                      }
                      onClick={() => void endorse(row)}
                      className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Visar {row.period.name}
                    </button>
                  )}
                </div>
                <EndorsementRowDetail row={row} abilities={abilities} onChanged={afterChange} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Seguimiento gradeBookId={gradeBookId} />
      <InformesDelGrupo periods={periods} />

      <WriteToTeacher teacher={detail?.teacher} />
    </div>
  )
}
