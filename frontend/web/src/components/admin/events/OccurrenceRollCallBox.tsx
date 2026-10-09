'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Loader2, UserRound } from 'lucide-react'
import { api } from '@/lib/api/client'
import {
  dayRollCallChipClass,
  dayRollCallLabel,
  dayRollCallPhase,
  type DayRollCall,
  type PersonRef,
} from '@/lib/rollcall/rollcall-phase'
import { rollCallHref } from '@/lib/rollcall/class-row'
import type { SessionStatus } from '@/lib/rollcall/rollcall-status'

type OccurrenceRollCallStatus = {
  eventId: string
  ymd: string
  startAt: string
  endAt: string
  opensAt: string
  teacher: PersonRef | null
  substitute: PersonRef | null
  nonWorkingDay: string | null
  rollCall: {
    status: SessionStatus
    takenAt: string | null
    takenBy: string | null
    rosterSize: number | null
    counts: { PRESENT: number; LATE: number; ABSENT: number; ABSENT_JUSTIFIED: number }
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "20 presentes · 2 tardes · 3 ausentes": lo que dejó la lista, sin abrirla. */
export function rollCallCountsLine(counts: OccurrenceRollCallStatus['rollCall']['counts']): string {
  const absent = counts.ABSENT + counts.ABSENT_JUSTIFIED
  return [
    plural(counts.PRESENT, 'presente', 'presentes'),
    plural(counts.LATE, 'tarde', 'tardes'),
    plural(absent, 'ausente', 'ausentes'),
  ].join(' · ')
}

/**
 * En el modal de una clase de la Agenda: quién la da ese día y cómo está su pase de lista (si se
 * pasó, quién, a qué hora y qué dejó), con enlace a la planilla para quien puede abrirla.
 */
export default function OccurrenceRollCallBox({
  eventId,
  ymd,
  canOpen,
}: {
  eventId: string
  ymd: string
  canOpen: boolean
}) {
  const [data, setData] = useState<OccurrenceRollCallStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api<OccurrenceRollCallStatus>(`/admin/student-attendance/sessions/${eventId}/${ymd}/status`)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo consultar la lista')
      })
    return () => {
      cancelled = true
    }
  }, [eventId, ymd])

  const dayRollCall: DayRollCall | null = data
    ? {
        eventId: data.eventId,
        ymd: data.ymd,
        status: data.rollCall.status,
        takenAt: data.rollCall.takenAt,
        takenBy: data.rollCall.takenBy,
        opensAt: data.opensAt,
        endAt: data.endAt,
      }
    : null

  return (
    <section aria-label="Pase de lista" className="mb-3 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-slate-800">
          <ClipboardList className="h-4 w-4 text-slate-500" aria-hidden />
          Pase de lista
        </p>
        {dayRollCall && !data?.nonWorkingDay ? (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${dayRollCallChipClass(dayRollCallPhase(dayRollCall))}`}>
            {dayRollCallLabel(dayRollCall)}
          </span>
        ) : null}
      </div>

      {!data && !error ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Consultando la lista…
        </p>
      ) : null}
      {error ? <p className="text-xs text-slate-600">{error}</p> : null}

      {data ? (
        <>
          <p className="flex items-center gap-1.5 text-slate-700">
            <UserRound className="h-4 w-4 text-slate-400" aria-hidden />
            Docente: {data.teacher?.name ?? 'Sin asignar'}
            {data.substitute ? ` · Suplente: ${data.substitute.name}` : ''}
          </p>
          {data.nonWorkingDay ? (
            <p className="text-xs text-amber-800">Día no laborable: {data.nonWorkingDay}. No se pasa lista.</p>
          ) : null}
          {data.rollCall.status === 'TAKEN' ? (
            <p className="text-xs text-slate-600">{rollCallCountsLine(data.rollCall.counts)}</p>
          ) : null}
          {canOpen && dayRollCall && !data.nonWorkingDay ? (
            <Link href={rollCallHref(dayRollCall)} className="inline-block text-sm font-semibold text-emerald-700 hover:underline">
              Abrir lista
            </Link>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
