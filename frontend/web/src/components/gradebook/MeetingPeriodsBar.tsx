'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, LockOpen } from 'lucide-react'
import { api } from '@/lib/api/client'

/**
 * Estado de los períodos con reunión de la libreta (entregas, diciembre, febrero) y el botón para
 * cerrarlos. Cerrar una entrega congela también los tramos que informa; si falta algo, se listan
 * todos los faltantes juntos para completarlos de una vez.
 */

type PeriodRow = {
  periodId: string
  name: string
  kind?: 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA'
  isMeeting?: boolean
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  closedLate?: boolean
}

type Blocker = { code: 'MISSING_GRADES' | 'MISSING_MEETING_GRADES' | 'MISSING_JUDGEMENT'; studentIds: string[] }

const BLOCKER_LABELS: Record<Blocker['code'], string> = {
  MISSING_GRADES: 'sin C',
  MISSING_MEETING_GRADES: 'sin R (nota de reunión)',
  MISSING_JUDGEMENT: 'sin informe o juicio',
}

type Message = { kind: 'ok' | 'error'; text: string } | null

/** El 409 del cierre trae la lista completa de faltantes en `detail.blockers`. */
export function closeErrorText(err: unknown): string {
  const data = (err as { data?: { message?: string; detail?: { blockers?: Blocker[] } } })?.data
  const blockers = data?.detail?.blockers ?? []
  if (blockers.length > 0) {
    const list = blockers.map((b) => `${b.studentIds.length} ${BLOCKER_LABELS[b.code] ?? b.code}`).join(' · ')
    return `No se puede cerrar todavía: ${list}.`
  }
  return data?.message ?? (err instanceof Error ? err.message : 'No se pudo cerrar')
}

export default function MeetingPeriodsBar({
  gradeBookId,
  canClose,
  onClosed,
}: {
  gradeBookId: string
  canClose: boolean
  onClosed?: () => void
}) {
  const [periods, setPeriods] = useState<PeriodRow[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
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
      onClosed?.()
    } catch (err) {
      setMessage({ kind: 'error', text: closeErrorText(err) })
    } finally {
      setBusy(null)
      setConfirming(null)
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
              className="flex items-center gap-1.5 rounded border border-amber-200 bg-white px-2 py-1"
            >
              {closed ? (
                <Lock className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              ) : (
                <LockOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              )}
              <span className="font-medium text-slate-800">{period.name}</span>
              <span className="text-slate-500">{closed ? 'cerrada' : 'abierta'}</span>
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
                  <button type="button" onClick={() => setConfirming(null)} className="text-slate-600 hover:underline">
                    No
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
