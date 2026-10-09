'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Clock, Loader2, UserRound } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { addDaysYmd, todayYmdUruguay } from '@/lib/libreta/absence-day'
import { useNow } from '@/lib/hooks/useNow'
import {
  classGroupLabel,
  classTeacherLine,
  formatRollCallDay,
  isRollCallDue,
  rollCallPhase,
  rollCallPhaseChipClass,
  rollCallPhaseLabel,
  type RollCallPhase,
} from '@/lib/rollcall/rollcall-phase'
import { rollCallHref, timingOf, type RollCallClassRow } from '@/lib/rollcall/class-row'

const YMD = /^\d{4}-\d{2}-\d{2}$/

type PhasedRow = RollCallClassRow & { phase: RollCallPhase }

function ClassCard({ row, meId, highlight }: { row: PhasedRow; meId: string | null; highlight: boolean }) {
  const teacherLine = classTeacherLine({ meId, teacher: row.teacher, substitute: row.substitute })
  const timing = timingOf(row)
  return (
    <li>
      <Link
        href={rollCallHref(row)}
        className={`block rounded-xl border bg-white p-4 transition hover:border-emerald-300 hover:bg-emerald-50/30 ${
          highlight ? 'border-emerald-300 shadow-sm ring-1 ring-emerald-200' : 'border-gray-200'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-base font-semibold text-gray-900">{classGroupLabel(row.course, row.orientation)}</p>
            <p className="text-sm text-gray-700">{row.subject ?? row.title}</p>
            <p className="flex items-center gap-1.5 text-xs tabular-nums text-gray-500">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {formatTimeInUruguay(row.startAt)}–{formatTimeInUruguay(row.endAt)}
            </p>
            {teacherLine ? (
              <p className="flex items-center gap-1.5 text-xs text-gray-600">
                <UserRound className="h-3.5 w-3.5" aria-hidden />
                {teacherLine}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${rollCallPhaseChipClass(row.phase)}`}>
              {rollCallPhaseLabel(row.phase, timing)}
            </span>
            {isRollCallDue(row.phase) ? (
              <span className="btn-primary px-3 py-1.5 text-sm">
                <ClipboardList className="h-4 w-4" aria-hidden />
                Pasar lista
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  )
}

function Section({ title, rows, meId, highlight = false }: { title: string; rows: PhasedRow[]; meId: string | null; highlight?: boolean }) {
  if (rows.length === 0) return null
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <ul className="space-y-2">
        {rows.map((row) => (
          <ClassCard key={`${row.eventId}-${row.ymd}`} row={row} meId={meId} highlight={highlight} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Las clases de un día con el estado de su lista. El día viaja en `?date=`: la planilla vuelve al
 * mismo día y el enlace se puede compartir.
 */
export default function RollCallTodayList() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const me = useOptionalAuth()?.me ?? null
  const now = useNow()
  const today = todayYmdUruguay(now)
  const requested = searchParams?.get('date') ?? ''
  const date = YMD.test(requested) ? requested : today

  const [rows, setRows] = useState<RollCallClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      setRows(await api<RollCallClassRow[]>(`/student-attendance/my-classes?date=${date}`))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudieron cargar tus clases')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  function goTo(ymd: string) {
    router.replace(ymd === today ? (pathname ?? '/me/roll-call') : `${pathname ?? '/me/roll-call'}?date=${ymd}`)
  }

  const phased: PhasedRow[] = rows.map((row) => ({ ...row, phase: rollCallPhase(timingOf(row), now) }))
  const current = phased.filter((row) => row.phase === 'OPEN')
  const later = phased.filter((row) => row.phase === 'UPCOMING')
  const done = phased.filter((row) => row.phase !== 'OPEN' && row.phase !== 'UPCOMING')
  const nonWorkingDay = rows.find((row) => row.nonWorkingDay)?.nonWorkingDay ?? null
  const meId = me?.id ?? null

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
          <ClipboardList className="h-7 w-7 text-emerald-600" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Pase de lista</h1>
          <p className="text-sm text-gray-600">
            La lista de cada clase se abre 10 minutos antes de empezar y se puede corregir durante el plazo.
          </p>
        </div>
      </header>

      <nav aria-label="Elegir día" className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
        <button type="button" className="btn-secondary px-2.5 py-1.5 text-sm" onClick={() => goTo(addDaysYmd(date, -1))}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Anterior</span>
        </button>
        <p className="min-w-0 flex-1 text-center text-sm font-semibold text-gray-900" aria-live="polite">
          {formatRollCallDay(date)}
          {date === today ? <span className="ml-1.5 font-normal text-emerald-700">· hoy</span> : null}
        </p>
        <button type="button" className="btn-secondary px-2.5 py-1.5 text-sm" onClick={() => goTo(addDaysYmd(date, 1))}>
          <span className="sr-only sm:not-sr-only">Siguiente</span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {date !== today ? (
            <button type="button" className="btn-secondary px-2.5 py-1.5 text-sm" onClick={() => goTo(today)}>
              Hoy
            </button>
          ) : null}
          <label className="relative flex-1 sm:flex-none">
            <span className="sr-only">Ir a una fecha</span>
            <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              type="date"
              className="input-field w-full py-1.5 pl-8 text-sm"
              value={date}
              onChange={(e) => {
                if (YMD.test(e.target.value)) goTo(e.target.value)
              }}
            />
          </label>
        </div>
      </nav>

      {msg ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</p> : null}
      {nonWorkingDay ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Día no laborable: {nonWorkingDay}. No se pasa lista.
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando clases…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No tenés clases ese día.
        </p>
      ) : (
        <div className="space-y-5">
          <Section title="Ahora" rows={current} meId={meId} highlight />
          <Section title="Más tarde" rows={later} meId={meId} />
          <Section title="Terminadas" rows={done} meId={meId} />
        </div>
      )}
    </div>
  )
}
