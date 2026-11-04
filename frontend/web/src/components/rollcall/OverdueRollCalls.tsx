'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2 } from 'lucide-react'
import { useIndicatorData } from '@/components/common/data-cache'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { dueText, type PendingRollCall } from '@/lib/home/my-day'
import { rollCallHref } from '@/lib/rollcall/class-row'
import { classGroupLabel, formatRollCallDay } from '@/lib/rollcall/rollcall-phase'
import { windowPhrase } from '@/lib/rollcall/rollcall-window'

type PendingResponse = { windowHours: number; data: PendingRollCall[] }

/**
 * Las listas de días anteriores que el docente dejó sin pasar y todavía puede pasar, la que vence
 * antes primero. Antes no aparecían en ningún lado: había que ir día por día en el pase de lista.
 */
export default function OverdueRollCalls({ tour, hideWhenEmpty = false }: Readonly<{ tour?: string; hideWhenEmpty?: boolean }>) {
  const pending = useIndicatorData<PendingResponse>('/student-attendance/mine/pending')
  const rows = pending.data?.data ?? []
  if (hideWhenEmpty && rows.length === 0) return null
  return (
    <section data-tour={tour} aria-labelledby="overdue-roll-calls" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <header>
        <h2 id="overdue-roll-calls" className="text-sm font-semibold text-slate-900">
          Listas atrasadas
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          De días anteriores, que todavía podés pasar
          {pending.data ? `: el plazo es de ${windowPhrase(pending.data.windowHours)} desde el fin de la clase` : ''}.
        </p>
      </header>
      {pending.error && (
        <p role="alert" className="text-sm text-red-800">
          No se pudieron revisar las listas atrasadas.{' '}
          <button type="button" onClick={pending.retry} className="font-semibold underline">
            Reintentar
          </button>
        </p>
      )}
      {!pending.data && !pending.error && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Revisando…
        </p>
      )}
      {pending.data && rows.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          Estás al día: no te quedó ninguna lista sin pasar.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={`${row.eventId}-${row.ymd}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">
                  {classGroupLabel(row.course, row.orientation)} · {row.subject ?? row.title}
                </span>
                <span className="block text-xs text-slate-500">
                  {formatRollCallDay(row.ymd)}, {formatTimeInUruguay(row.startAt)}
                  {row.covered && row.titular?.name ? ` · suplencia de ${row.titular.name}` : ''}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {dueText(row.editableUntil)}
              </span>
              <Link href={rollCallHref(row)} className="btn-primary px-3 py-1.5 text-sm">
                <ClipboardList className="h-4 w-4" aria-hidden />
                Pasar lista
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
