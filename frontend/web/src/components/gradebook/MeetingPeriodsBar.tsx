'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, LockOpen } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'

/**
 * Estado de los períodos con reunión de la libreta (entregas, diciembre, febrero) y el botón para
 * cerrarlos. Cerrar una entrega congela también los tramos que informa; si falta algo, se listan
 * todos los faltantes juntos para completarlos de una vez.
 *
 * Quien tiene `gradebook.manage` (administración) puede además reabrir una reunión cerrada, con
 * motivo: es lo que permite corregir lo que observó adscripción. El docente recibe el aviso.
 */

type PeriodRow = {
  periodId: string
  name: string
  kind?: 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA'
  isMeeting?: boolean
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  closedLate?: boolean
}

type Blocker = {
  code: 'MISSING_GRADES' | 'MISSING_CONDUCT' | 'MISSING_JUDGEMENT' | 'MISSING_GROUP_REPORT'
  studentIds: string[]
}

const BLOCKER_LABELS: Record<Blocker['code'], string> = {
  MISSING_GRADES: 'sin R (rendimiento)',
  MISSING_CONDUCT: 'sin C (conducta)',
  MISSING_JUDGEMENT: 'sin informe o juicio',
  MISSING_GROUP_REPORT: 'falta el informe del grupo',
}

/** "3 sin R (rendimiento)"; el informe del grupo no es de alumnos, va sin número. */
function blockerText(blocker: Blocker): string {
  const label = BLOCKER_LABELS[blocker.code] ?? blocker.code
  return blocker.code === 'MISSING_GROUP_REPORT' ? label : `${blocker.studentIds.length} ${label}`
}

const STATUS_TEXT: Record<PeriodRow['status'], string> = {
  OPEN: 'abierta',
  CLOSED: 'cerrada',
  REOPENED: 'reabierta',
}

type Message = { kind: 'ok' | 'error'; text: string } | null

/** El 409 del cierre trae la lista completa de faltantes en `detail.blockers`. */
export function closeErrorText(err: unknown): string {
  const data = (err as { data?: { message?: string; detail?: { blockers?: Blocker[] } } })?.data
  const blockers = data?.detail?.blockers ?? []
  if (blockers.length > 0) {
    const list = blockers.map(blockerText).join(' · ')
    return `No se puede cerrar todavía: ${list}.`
  }
  return data?.message ?? (err instanceof Error ? err.message : 'No se pudo cerrar')
}

const LINK_BUTTON = 'text-slate-600 hover:underline'

export default function MeetingPeriodsBar({
  gradeBookId,
  canClose,
  onChanged,
}: {
  gradeBookId: string
  canClose: boolean
  /** Se cerró o se reabrió una reunión: quien la usa recarga lo que depende del estado. */
  onChanged?: () => void
}) {
  const auth = useOptionalAuth()
  const canReopen = hasPermission(auth?.me, 'gradebook.manage', 'all')
  const [periods, setPeriods] = useState<PeriodRow[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const [reopening, setReopening] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<Message>(null)

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: PeriodRow[] }>(`/gradebook/${gradeBookId}/periods`)
      setPeriods((res?.data ?? []).filter((p) => p.isMeeting))
    } catch {
      setPeriods([])
    }
  }, [gradeBookId])

  useEffect(() => {
    void load()
  }, [load])

  async function close(period: PeriodRow) {
    setBusy(period.periodId)
    setMessage(null)
    try {
      const res = await api<{ closedLate: boolean; coveredPeriodCodes?: string[] }>(
        `/gradebook/${gradeBookId}/periods/${period.periodId}/close`,
        { method: 'POST' },
      )
      const covered = res.coveredPeriodCodes?.length ? ' y sus tramos' : ''
      const late = res.closedLate ? ' (fuera de plazo)' : ''
      setMessage({ kind: 'ok', text: `Se cerró ${period.name}${covered}${late}.` })
      await load()
      onChanged?.()
    } catch (err) {
      setMessage({ kind: 'error', text: closeErrorText(err) })
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  async function reopen(period: PeriodRow) {
    setBusy(period.periodId)
    setMessage(null)
    try {
      const res = await api<{ coveredPeriodCodes?: string[] }>(
        `/gradebook/${gradeBookId}/periods/${period.periodId}/reopen`,
        { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) },
      )
      const covered = res.coveredPeriodCodes?.length ? ' y sus tramos' : ''
      setMessage({ kind: 'ok', text: `Se reabrió ${period.name}${covered}. El docente recibió el aviso.` })
      setReopening(null)
      setReason('')
      await load()
      onChanged?.()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo reabrir' })
    } finally {
      setBusy(null)
    }
  }

  if (periods.length === 0) return null

  return (
    <section aria-label="Entregas y reuniones" className="rounded border border-amber-200 bg-amber-50/60 px-3 py-2">
      <ul className="flex flex-wrap gap-2 text-xs">
        {periods.map((period) => {
          const closed = period.status === 'CLOSED'
          return (
            <li
              key={period.periodId}
              className="flex flex-wrap items-center gap-1.5 rounded border border-amber-200 bg-white px-2 py-1"
            >
              {closed ? (
                <Lock className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              ) : (
                <LockOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              )}
              <span className="font-medium text-slate-800">{period.name}</span>
              <span className="text-slate-500">{STATUS_TEXT[period.status] ?? period.status}</span>
              {!closed && canClose && confirming !== period.periodId && (
                <button
                  type="button"
                  onClick={() => setConfirming(period.periodId)}
                  className="rounded border border-teal-600 px-1.5 py-0.5 font-semibold text-teal-700 hover:bg-teal-50"
                >
                  Cerrar
                </button>
              )}
              {confirming === period.periodId && (
                <>
                  <span className="text-slate-600">
                    {period.kind === 'ENTREGA' ? '¿Cerrar la entrega y sus tramos?' : '¿Cerrar?'}
                  </span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void close(period)}
                    className="rounded bg-teal-700 px-1.5 py-0.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                  >
                    {busy === period.periodId ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : 'Confirmar'}
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className={LINK_BUTTON}>
                    No
                  </button>
                </>
              )}
              {closed && canReopen && reopening !== period.periodId && (
                <button
                  type="button"
                  onClick={() => {
                    setReopening(period.periodId)
                    setReason('')
                  }}
                  className="rounded border border-slate-400 px-1.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Reabrir
                </button>
              )}
              {reopening === period.periodId && (
                <>
                  <input
                    aria-label={`Motivo para reabrir ${period.name}`}
                    placeholder="Motivo (lo ve el docente)"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    className="input-field h-7 w-56 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy !== null || reason.trim().length < 3}
                    onClick={() => void reopen(period)}
                    className="rounded bg-slate-700 px-1.5 py-0.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {busy === period.periodId ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : 'Reabrir'}
                  </button>
                  <button type="button" onClick={() => setReopening(null)} className={LINK_BUTTON}>
                    Cancelar
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`mt-2 text-xs ${message.kind === 'error' ? 'text-red-800' : 'text-green-800'}`}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
