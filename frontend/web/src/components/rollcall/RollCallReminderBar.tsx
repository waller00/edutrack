'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, ClipboardList } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { useNow } from '@/lib/hooks/useNow'
import { classGroupLabel, rollCallPhase, type RollCallPhase } from '@/lib/rollcall/rollcall-phase'
import { rollCallHref, ROLL_CALL_SAVED_EVENT, timingOf, type RollCallClassRow } from '@/lib/rollcall/class-row'

/** Cada cuánto, como mucho, se vuelve a preguntar al servidor (al navegar, al volver a la pestaña). */
const REFRESH_MS = 5 * 60 * 1000
/** "Más tarde" esconde el aviso de una lista atrasada durante una hora. */
const SNOOZE_MS = 60 * 60 * 1000
const SNOOZE_KEY = 'edutrack.rollcall.snoozedUntil'

function readSnooze(): number {
  try {
    return Number(globalThis.sessionStorage?.getItem(SNOOZE_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function writeSnooze(until: number) {
  try {
    globalThis.sessionStorage?.setItem(SNOOZE_KEY, String(until))
  } catch {
    // Sin almacenamiento (modo privado): el aviso se esconde sólo hasta recargar.
  }
}

type Phased = { row: RollCallClassRow; phase: RollCallPhase }

function classSummary(row: RollCallClassRow): string {
  return `${classGroupLabel(row.course, row.orientation)} · ${row.subject ?? row.title}`
}

function timeRange(row: RollCallClassRow): string {
  return `${formatTimeInUruguay(row.startAt)}–${formatTimeInUruguay(row.endAt)}`
}

/**
 * Franja debajo del encabezado, en todas las pantallas, que le recuerda al docente pasar la lista:
 * - verde mientras la clase está abierta (desde 10 minutos antes) y la lista sin pasar;
 * - ámbar si una clase de hoy terminó sin lista, con "Más tarde" para esconderla una hora.
 * Desaparece al guardar la lista. No aparece en "Pase de lista", que ya muestra todo, ni en la
 * planilla de la misma clase.
 */
export default function RollCallReminderBar() {
  const pathname = usePathname()
  const now = useNow(30_000)
  const [items, setItems] = useState<RollCallClassRow[]>([])
  const [snoozedUntil, setSnoozedUntil] = useState(readSnooze)
  const lastFetch = useRef(0)

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetch.current < REFRESH_MS) return
    lastFetch.current = Date.now()
    try {
      const res = await api<{ items?: RollCallClassRow[] }>('/student-attendance/reminder')
      setItems(Array.isArray(res?.items) ? res.items : [])
    } catch {
      // Sin aviso no se rompe nada: las listas siguen en "Pase de lista".
      setItems([])
    }
  }, [])

  // Al entrar, al navegar y con el reloj: como mucho una consulta cada 5 minutos.
  useEffect(() => {
    void load()
  }, [load, pathname, now])

  useEffect(() => {
    const onSaved = () => void load(true)
    const onFocus = () => void load()
    globalThis.addEventListener?.(ROLL_CALL_SAVED_EVENT, onSaved)
    globalThis.addEventListener?.('focus', onFocus)
    return () => {
      globalThis.removeEventListener?.(ROLL_CALL_SAVED_EVENT, onSaved)
      globalThis.removeEventListener?.('focus', onFocus)
    }
  }, [load])

  if (pathname === '/me/roll-call') return null

  const visible: Phased[] = items
    .filter((row) => pathname !== rollCallHref(row))
    .map((row) => ({ row, phase: rollCallPhase(timingOf(row), now) }))
    .sort((a, b) => new Date(a.row.startAt).getTime() - new Date(b.row.startAt).getTime())
  const current = visible.find((item) => item.phase === 'OPEN')
  const overdue = visible.filter((item) => item.phase === 'OVERDUE')

  if (current) {
    return (
      <div role="status" className="border-t border-emerald-200 bg-emerald-50">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4 lg:px-6">
          <ClipboardList className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
          <p className="min-w-0 flex-1 text-sm leading-snug text-emerald-950">
            <span className="font-semibold">Ahora: </span>
            {classSummary(current.row)} <span className="whitespace-nowrap tabular-nums">· {timeRange(current.row)}</span>
            {overdue.length > 0 ? (
              <Link href="/me/roll-call" className="ml-2 whitespace-nowrap font-medium text-amber-800 underline">
                {overdue.length === 1 ? '1 lista sin pasar' : `${overdue.length} listas sin pasar`}
              </Link>
            ) : null}
          </p>
          <Link href={rollCallHref(current.row)} className="btn-primary shrink-0 px-3 py-1.5 text-sm">
            Pasar lista
          </Link>
        </div>
      </div>
    )
  }

  const first = overdue[0]
  if (!first || now.getTime() < snoozedUntil) return null

  return (
    <div role="status" className="border-t border-amber-200 bg-amber-50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4 lg:px-6">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden />
        <p className="min-w-0 flex-1 text-sm leading-snug text-amber-950">
          Quedó sin pasar la lista de {classSummary(first.row)}{' '}
          <span className="whitespace-nowrap tabular-nums">({timeRange(first.row)})</span>
          {overdue.length > 1 ? (
            <Link href="/me/roll-call" className="ml-1 whitespace-nowrap font-medium underline">
              y {overdue.length - 1} más
            </Link>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            onClick={() => {
              const until = Date.now() + SNOOZE_MS
              writeSnooze(until)
              setSnoozedUntil(until)
            }}
          >
            Más tarde
          </button>
          <Link href={rollCallHref(first.row)} className="btn-primary px-3 py-1.5 text-sm">
            Pasar lista
          </Link>
        </div>
      </div>
    </div>
  )
}
