'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, ClipboardList, Loader2, MessageCircle } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { useLibreta } from '@/contexts/LibretaContext'
import { useOptionalMessages } from '@/components/messages/MessagesProvider'
import CierreGrupoTable from '@/components/gradebook/CierreGrupoTable'
import { endorsementGridPath } from '@/components/admin/gradebook/EndorsementGrid'
import { hasPermission } from '@/lib/auth/permissions'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import {
  endorsementAbilities,
  formatEndorsementDate,
  nextForReview,
  reviewState,
  visadoHref,
  type EndorsementRow,
} from '@/lib/gradebook/endorsements'
import type { GroupFilter } from '@/lib/gradebook/group-filter'
import { sectionHref } from '@/lib/libreta/menu'
import VisadoDecision, { type DecisionRow } from './VisadoDecision'
import MeetingStepper from '@/components/gradebook/MeetingStepper'
import { meetingStage } from '@/lib/gradebook/meeting-stage'

/** En qué etapa está la reunión elegida (Cargar → Cerrar → Revisión → Visada), para quien revisa. */
function ReviewStage({ row }: { row: DecisionRow }) {
  const stage = meetingStage(
    { periodStatus: row.periodStatus, missing: null, reopenReason: row.reopenReason, endorsement: row },
    'reviewer',
  )
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <MeetingStepper stage={stage.stage} hint={stage.hint} />
    </div>
  )
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

/** Las reuniones que se revisan: las cerradas, y las reabiertas para corregir (siguen mostrando qué se observó). */
export function reviewableMeetings(rows: readonly DecisionRow[]): DecisionRow[] {
  return rows.filter((row) => row.periodStatus === 'CLOSED' || row.history.length > 0)
}

/**
 * La reunión con la que abre: la pedida (`?reunion=`, desde Control); si no, la primera cerrada
 * sin visar; si están todas visadas, la última.
 */
export function openingMeeting(rows: readonly DecisionRow[], requested: string | null): DecisionRow | null {
  return (
    rows.find((row) => row.period.id === requested) ??
    rows.find((row) => row.periodStatus === 'CLOSED' && row.overallStatus !== 'ENDORSED') ??
    rows.at(-1) ??
    null
  )
}

/** El grupo que se filtró en Control, si vino en la URL: "Siguiente" recorre esa misma lista. */
function groupFromParams(params: Pick<URLSearchParams, 'get'> | null): GroupFilter | null {
  const courseOfferingId = params?.get('courseOfferingId')
  if (!courseOfferingId) return null
  return { courseOfferingId, courseOrientationId: params?.get('courseOrientationId') ?? null }
}

function MeetingPicker({
  rows,
  selectedId,
  onSelect,
}: {
  rows: readonly DecisionRow[]
  selectedId: string
  onSelect: (periodId: string) => void
}) {
  return (
    <div role="group" aria-label="Reunión a revisar" className="flex flex-wrap gap-2">
      {rows.map((row) => {
        const state = reviewState(row)
        const selected = row.period.id === selectedId
        return (
          <button
            key={row.gradeBookPeriodId}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(row.period.id)}
            className={`rounded-lg border px-3 py-2 text-left ${
              selected ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <span className="block text-sm font-semibold text-gray-900">{row.period.name}</span>
            <span className="block text-xs text-gray-600">
              <span aria-hidden>{state.symbol}</span> {state.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Volver a la bandeja de Control o seguir con la próxima libreta de la misma reunión que espera
 * que alguien la mire. Sólo para quien ve todas las libretas: la bandeja es de supervisión.
 */
function ReviewNavigation({
  gradeBookId,
  periodId,
  schoolYearId,
  group,
  refreshKey,
}: {
  gradeBookId: string
  periodId: string
  schoolYearId: string
  group: GroupFilter | null
  /** Cambia después de cada decisión: la bandeja se vuelve a pedir. */
  refreshKey: number
}) {
  const me = useOptionalAuth()?.me ?? null
  const canList = hasPermission(me, 'gradebook.read', 'all') && periodId !== ''
  const [queue, setQueue] = useState<EndorsementRow[] | null>(null)
  const path = withSchoolYear(endorsementGridPath({ periodId, group, pendingOnly: true }), `schoolYearId=${schoolYearId}`)

  useEffect(() => {
    if (!canList) return
    let cancelled = false
    setQueue(null)
    api<{ data: EndorsementRow[] }>(path)
      .then((res) => {
        if (!cancelled) setQueue(res.data)
      })
      .catch(() => {
        if (!cancelled) setQueue([])
      })
    return () => {
      cancelled = true
    }
  }, [canList, path, refreshKey])

  if (!canList) return null
  const next = queue ? nextForReview(queue, gradeBookId) : null

  return (
    <nav aria-label="Revisión de libretas" data-tour="visado.next" className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
      <Link href="/libreta/control?paso=visado" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-emerald-700">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Volver a Control y visado
      </Link>
      {next ? (
        <Link
          href={visadoHref(next.gradeBookId, periodId, group)}
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
        >
          Siguiente para revisar: {next.subject.name} ({next.courseName})
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        queue && <span className="text-sm text-gray-500">No quedan libretas para revisar en esta reunión.</span>
      )}
    </nav>
  )
}

/**
 * "Revisión y visado" de una libreta: se revisa una reunión a la vez, en dos pasos.
 *
 * 1. **Lo que cerró el docente**: la C, la R y el juicio de cada alumno con el informe del grupo,
 *    de sólo lectura, y si dio lo que planificó.
 * 2. **Tu decisión**: Dirección la visa; Adscripción o Dirección le hacen una observación.
 *
 * Es el único lugar donde se visa: la bandeja de Control trae hasta acá ("Revisar") y desde acá se
 * sigue con la próxima. Visar sin haber mirado la libreta —desde la fila, o en lote— no existe más.
 */
export default function VisadoDireccionSection() {
  const { gradeBookId, detail } = useLibreta()
  const me = useOptionalAuth()?.me ?? null
  const abilities = useMemo(() => endorsementAbilities(me), [me])
  const params = useSearchParams()
  const requested = params?.get('reunion') ?? null
  const group = useMemo(() => groupFromParams(params), [params])
  const [rows, setRows] = useState<DecisionRow[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: DecisionRow[] }>(`/gradebook/${gradeBookId}/endorsements`)
      setRows(res.data)
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
    setRefreshKey((key) => key + 1)
    await load()
  }

  if (rows === null) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando visado…
      </p>
    )
  }

  const meetings = reviewableMeetings(rows)
  const selected = openingMeeting(meetings, chosen ?? requested)

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

      {selected ? (
        <>
          {meetings.length > 1 && (
            <MeetingPicker
              rows={meetings}
              selectedId={selected.period.id}
              onSelect={(periodId) => {
                setChosen(periodId)
                setMessage(null)
              }}
            />
          )}

          <section className="space-y-3" aria-labelledby="visado-revision" data-tour="visado.review">
            {/* Las mismas etapas que ve el docente en su cierre, con las palabras de quien revisa. */}
            <ReviewStage row={selected} />
            <div>
              <h3 id="visado-revision" className="text-sm font-semibold text-gray-900">
                1. Lo que cerró el docente · {selected.period.name}
              </h3>
              <p className="text-xs text-gray-600">
                C, R y juicio de cada alumno, y el informe del grupo, tal como los cerró.{' '}
                <Link href={sectionHref(gradeBookId, 'evaluaciones')} className="text-emerald-700 hover:underline">
                  Ver cada evaluación
                </Link>
              </p>
            </div>
            <CierreGrupoTable key={selected.period.id} gradeBookId={gradeBookId} periodId={selected.period.id} readOnly />
            <Seguimiento gradeBookId={gradeBookId} />
          </section>

          <VisadoDecision key={selected.gradeBookPeriodId} row={selected} abilities={abilities} onChanged={afterChange} />
        </>
      ) : (
        <>
          <p className="rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
            {detail?.teacher?.name ?? 'El docente'} todavía no cerró ninguna reunión: no hay nada para visar. Igual
            podés revisar el seguimiento y escribirle.
          </p>
          <Seguimiento gradeBookId={gradeBookId} />
        </>
      )}

      <WriteToTeacher teacher={detail?.teacher} />

      {detail && (
        <ReviewNavigation
          gradeBookId={gradeBookId}
          periodId={selected?.period.id ?? requested ?? ''}
          schoolYearId={detail.schoolYear.id}
          group={group}
          refreshKey={refreshKey}
        />
      )}
    </div>
  )
}
