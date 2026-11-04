'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Clock, Loader2, UserRound } from 'lucide-react'
import { IndicatorDataProvider, useIndicatorData, type IndicatorData } from '@/components/common/data-cache'
import OverdueRollCalls from '@/components/rollcall/OverdueRollCalls'
import { libretaCode } from '@/components/libreta/MisLibretas'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission, permissionScope } from '@/lib/auth/permissions'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { useNow } from '@/lib/hooks/useNow'
import { todayYmdUruguay } from '@/lib/libreta/absence-day'
import { closingsByMeeting, isMyRollCall, liveObservations, teacherDayTally, type MeetingClosing, type TodayClass } from '@/lib/home/my-day'
import { ownerSummaries, type LibretaSummary } from '@/lib/gradebook/libreta-status'
import { groupLine, type GroupIndicators } from '@/lib/gradebook/group-indicators'
import type { GradeBookHeader } from '@/lib/gradebook/types'
import { rollCallHref, timingOf } from '@/lib/rollcall/class-row'
import {
  classGroupLabel,
  classTeacherLine,
  isRollCallDue,
  rollCallPhase,
  rollCallPhaseChipClass,
  rollCallPhaseLabel,
} from '@/lib/rollcall/rollcall-phase'

const dayMonth = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

function Panel({ id, title, hint, tour, children }: Readonly<{ id: string; title: string; hint?: React.ReactNode; tour?: string; children: React.ReactNode }>) {
  return (
    <section data-tour={tour} aria-labelledby={id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold text-slate-900">
          {title}
        </h2>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function Waiting({ state, what }: Readonly<{ state: IndicatorData<unknown>; what: string }>) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-red-800">
        No se pudo cargar {what}.{' '}
        <button type="button" onClick={state.retry} className="font-semibold underline">
          Reintentar
        </button>
      </p>
    )
  }
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Cargando {what}…
    </p>
  )
}

function ClassRow({ row, meId, now }: Readonly<{ row: TodayClass; meId: string | null; now: Date }>) {
  const timing = timingOf(row)
  const phase = rollCallPhase(timing, now)
  const teacherLine = classTeacherLine({ meId, teacher: row.teacher, substitute: row.substitute })
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">
        <Clock className="mr-1 inline h-3.5 w-3.5" aria-hidden />
        {formatTimeInUruguay(row.startAt)}–{formatTimeInUruguay(row.endAt)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">
          {classGroupLabel(row.course, row.orientation)} · {row.subject ?? row.title}
        </span>
        {teacherLine && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <UserRound className="h-3.5 w-3.5" aria-hidden />
            {teacherLine}
          </span>
        )}
      </span>
      {row.onLicense ? (
        <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800">Con licencia: no la das</span>
      ) : (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${rollCallPhaseChipClass(phase)}`}>{rollCallPhaseLabel(phase, timing)}</span>
      )}
      {!row.onLicense && isRollCallDue(phase) ? (
        <Link href={rollCallHref(row)} className="btn-primary px-3 py-1.5 text-sm">
          <ClipboardList className="h-4 w-4" aria-hidden />
          Pasar lista
        </Link>
      ) : (
        <Link href={rollCallHref(row)} className="text-sm font-medium text-emerald-700 hover:underline">
          Ver lista
        </Link>
      )}
    </li>
  )
}

/** Las clases de hoy con su lista: qué toca ahora, qué quedó sin pasar y cuántas van. */
function TodayClasses() {
  const me = useOptionalAuth()?.me ?? null
  const now = useNow()
  const classes = useIndicatorData<TodayClass[]>(`/student-attendance/my-classes?date=${todayYmdUruguay(now)}`)
  const rows = classes.data ?? []
  const nonWorkingDay = rows.find((row) => row.nonWorkingDay)?.nonWorkingDay ?? null
  const tally = teacherDayTally(rows, now)
  return (
    <Panel
      id="mi-dia-hoy"
      title="Tus clases de hoy"
      tour="home.today"
      hint={tally.opened > 0 ? `Listas pasadas: ${tally.taken} de ${tally.opened}` : undefined}
    >
      {!classes.data && <Waiting state={classes} what="tus clases" />}
      {nonWorkingDay && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Día no laborable: {nonWorkingDay}. No se pasa lista.</p>}
      {classes.data && rows.length === 0 && <p className="text-sm text-slate-600">Hoy no tenés clases.</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <ClassRow key={`${row.eventId}-${row.ymd}`} row={row} meId={me?.id ?? null} now={now} />
          ))}
        </ul>
      )}
      {rows.some((row) => isMyRollCall(row, now)) && (
        <Link href="/me/roll-call" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
          Ir al pase de lista <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </Panel>
  )
}

function ClosingGroup({ group }: Readonly<{ group: MeetingClosing }>) {
  return (
    <li className="space-y-2">
      <p className="text-sm text-slate-800">
        <span className="font-semibold">{group.name}</span>
        {group.closesOn ? ` · cierra el ${dayMonth(group.closesOn)}` : ''}
        <span className="text-slate-500">
          {' '}
          · {group.closed} de {group.total} {group.total === 1 ? 'libreta cerrada' : 'libretas cerradas'}
        </span>
      </p>
      <ul className="space-y-1.5">
        {group.open.map((item) => (
          <li key={item.gradeBookId} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{item.label}</span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${item.stage.className}`}>
                <span aria-hidden>{item.stage.symbol}</span>
                {item.stage.label}
              </span>
              <Link href={`/libreta/${item.gradeBookId}/cierre?periodId=${item.periodId}`} className="ml-auto text-sm font-medium text-emerald-700 hover:underline">
                {item.missing.length === 0 ? 'Cerrarla' : 'Completar'}
              </Link>
            </div>
            {item.missing.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {item.missing.slice(0, 2).map((text) => (
                  <li key={text}>· {text}</li>
                ))}
                {item.missing.length > 2 && <li>y {item.missing.length - 2} más</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </li>
  )
}

function useLibretas() {
  const summary = useIndicatorData<{ data: LibretaSummary[] }>('/gradebook/mine/summary')
  const mine = useIndicatorData<{ data: GradeBookHeader[] }>('/gradebook/mine')
  const labels = new Map((mine.data?.data ?? []).map((book) => [book.id, libretaCode(book)]))
  const summaries = [...ownerSummaries(summary.data?.data).values()]
  return { summary, summaries, labelOf: (id: string) => labels.get(id) ?? 'Libreta' }
}

/** Las reuniones que vienen: cuántas libretas cerró, y qué le falta a cada una de las otras. */
function MeetingClosings() {
  const { summary, summaries, labelOf } = useLibretas()
  const closings = closingsByMeeting(summaries, labelOf)
  return (
    <Panel id="mi-dia-cierres" title="Reuniones por cerrar" tour="home.closings" hint="La misma cuenta que mira Dirección en el control">
      {!summary.data && <Waiting state={summary} what="tus libretas" />}
      {summary.data && closings.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          No tenés reuniones para cerrar.
        </p>
      )}
      {closings.length > 0 && (
        <ul className="space-y-4">
          {closings.map((group) => (
            <ClosingGroup key={group.periodId} group={group} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Lo que Dirección o Adscripción observaron y espera corrección. Sólo si hay algo. */
function ReviewObservations() {
  const { summaries, labelOf } = useLibretas()
  const observations = liveObservations(summaries, labelOf)
  if (observations.length === 0) return null
  return (
    <Panel id="mi-dia-observaciones" title="Te observaron">
      <ul className="space-y-2">
        {observations.map((item) => (
          <li key={`${item.gradeBookId}-${item.periodId}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {item.label} · {item.meetingName}
              <Link href={`/libreta/${item.gradeBookId}/cierre?periodId=${item.periodId}`} className="ml-auto text-sm font-medium text-emerald-800 hover:underline">
                Ver en el cierre
              </Link>
            </p>
            <ul className="mt-1 space-y-1">
              {item.sections.map((section) => (
                <li key={section.section}>
                  <span className="font-medium">{section.label}</span>
                  {section.by ? <span className="text-xs text-amber-800"> · {section.by}</span> : null}
                  {section.text && <span className="block whitespace-pre-wrap">{section.text}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

type GroupSummary = Pick<GroupIndicators, 'attendance' | 'grades' | 'evolution'> & { gradeBookId: string }

/** Una línea por grupo con lo esencial de su seguimiento, y el enlace a verlo entero. */
function MyGroupsPanel() {
  const groups = useIndicatorData<{ data: GroupSummary[] }>('/gradebook/mine/indicators')
  const { labelOf } = useLibretas()
  const rows = groups.data?.data ?? []
  return (
    <Panel id="mi-dia-grupos" title="Tus grupos" hint="En tu materia: faltas a tus clases, R en alerta y quiénes bajaron">
      {!groups.data && <Waiting state={groups} what="tus grupos" />}
      {groups.data && rows.length === 0 && <p className="text-sm text-slate-600">No tenés libretas a cargo este ciclo.</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => {
            const parts = groupLine(row)
            return (
              <li key={row.gradeBookId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium text-slate-900">{labelOf(row.gradeBookId)}</span>
                <span className="min-w-0 flex-1 text-slate-600">{parts.length > 0 ? parts.join(' · ') : 'Todavía sin listas ni notas de boletín.'}</span>
                <Link href={`/libreta/${row.gradeBookId}/seguimiento`} className="text-sm font-medium text-emerald-700 hover:underline">
                  Ver seguimiento
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/**
 * «Mi día», el Inicio del docente: lo que tiene que hacer hoy y lo que le quedó pendiente, en un solo
 * lugar. Antes eran cuatro próximas clases sin el estado de la lista y los mismos accesos del menú.
 */
export default function TeacherDay() {
  const me = useOptionalAuth()?.me ?? null
  const takesRollCall = hasPermission(me, 'student-attendance.take')
  const ownLibretas = permissionScope(me, 'gradebook.read') === 'own'
  return (
    <IndicatorDataProvider>
      <div className="space-y-5">
        {takesRollCall && <TodayClasses />}
        {takesRollCall && <OverdueRollCalls tour="home.pending" />}
        {ownLibretas && <ReviewObservations />}
        {ownLibretas && <MeetingClosings />}
        {ownLibretas && <MyGroupsPanel />}
      </div>
    </IndicatorDataProvider>
  )
}
