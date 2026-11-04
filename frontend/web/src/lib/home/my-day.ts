import { APP_TIMEZONE } from '@/lib/forms/datetime-uy'
import { getRoleLabel } from '@/lib/roles/display'
import { timingOf, type RollCallClassRow } from '@/lib/rollcall/class-row'
import { rollCallPhase, type RollCallPhase } from '@/lib/rollcall/rollcall-phase'
import { ENDORSEMENT_SECTION_LABELS, sectionState } from '@/lib/gradebook/endorsements'
import { meetingStageOf, missingTexts, type OwnerSummary } from '@/lib/gradebook/libreta-status'
import type { MeetingStage } from '@/lib/gradebook/meeting-stage'

/**
 * «Mi día», el Inicio del docente: sus clases de hoy con la lista, las listas atrasadas que todavía
 * puede pasar, las reuniones que tiene que cerrar y lo que le observaron. Todo derivado de lo que
 * devuelven `my-classes`, `mine/pending` y `gradebook/mine/summary`.
 */

/** Una clase de hoy; `onLicense` si es del titular y ese día tiene licencia. */
export type TodayClass = RollCallClassRow & { onLicense?: boolean }

const notMine = new Set<RollCallPhase>(['COVERED', 'NOT_ASSIGNED'])

/** ¿La lista de esta clase es suya? No la cubierta por otro, ni la del día de licencia. */
export function isMyRollCall(row: TodayClass, now = new Date()): boolean {
  return !row.nonWorkingDay && !row.onLicense && !notMine.has(rollCallPhase(timingOf(row), now))
}

/** «Listas pasadas 2 de 4»: de las suyas que ya abrieron, cuántas pasó. */
export function teacherDayTally(rows: readonly TodayClass[], now = new Date()): { taken: number; opened: number } {
  const opened = rows.filter((row) => isMyRollCall(row, now) && rollCallPhase(timingOf(row), now) !== 'UPCOMING')
  return { taken: opened.filter((row) => row.rollCall.status === 'TAKEN').length, opened: opened.length }
}

/** Una lista atrasada de días anteriores (`GET /student-attendance/mine/pending`). */
export type PendingRollCall = {
  eventId: string
  ymd: string
  title: string
  subject: string | null
  course: string | null
  orientation: string | null
  startAt: string
  endAt: string
  editableUntil: string
  sessionId: string | null
  daysLate: number
  covered: boolean
  titular: { id: string; name: string | null } | null
}

const DUE_FORMAT = new Intl.DateTimeFormat('es-UY', {
  timeZone: APP_TIMEZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** «Vence el jue 6/11 a las 12:40». */
export function dueText(editableUntil: string): string {
  const parts = Object.fromEntries(DUE_FORMAT.formatToParts(new Date(editableUntil)).map((part) => [part.type, part.value]))
  const weekday = String(parts.weekday ?? '').replace('.', '')
  return `Vence el ${weekday} ${parts.day}/${parts.month} a las ${parts.hour}:${parts.minute}`
}

export type ClosingItem = {
  gradeBookId: string
  label: string
  periodId: string
  stage: MeetingStage
  missing: string[]
}

export type MeetingClosing = {
  periodId: string
  name: string
  closesOn: string | null
  /** Libretas con esa reunión, y cuántas ya la cerraron. */
  total: number
  closed: number
  /** Las que todavía no la cerraron, primero las que más les falta. */
  open: ClosingItem[]
}

type OpenMeeting = { periodId: string; name: string; closesOn: string | null; item: ClosingItem }

/** La primera reunión sin cerrar de una libreta, con lo que le falta. */
function nextOpenMeeting(summary: OwnerSummary, label: string): OpenMeeting | null {
  const meeting = summary.meetings.find((row) => row.status !== 'CLOSED')
  if (!meeting) return null
  return {
    periodId: meeting.periodId,
    name: meeting.name,
    closesOn: meeting.closesOn,
    item: { gradeBookId: summary.gradeBookId, label, periodId: meeting.periodId, stage: meetingStageOf(meeting), missing: missingTexts(meeting, summary.students) },
  }
}

/**
 * Las reuniones que vienen, cada una con cuántas libretas ya la cerraron («1 de 6 cerradas») y lo
 * que le falta a cada una de las otras. Las que vencen antes, primero.
 */
export function closingsByMeeting(summaries: readonly OwnerSummary[], labelOf: (gradeBookId: string) => string): MeetingClosing[] {
  const groups = new Map<string, MeetingClosing>()
  for (const summary of summaries) {
    const next = nextOpenMeeting(summary, labelOf(summary.gradeBookId))
    if (!next) continue
    const group = groups.get(next.periodId) ?? { periodId: next.periodId, name: next.name, closesOn: next.closesOn, total: 0, closed: 0, open: [] }
    group.open.push(next.item)
    groups.set(next.periodId, group)
  }
  for (const group of groups.values()) {
    const withMeeting = summaries.filter((s) => s.meetings.some((m) => m.periodId === group.periodId))
    group.total = withMeeting.length
    group.closed = withMeeting.filter((s) => s.meetings.some((m) => m.periodId === group.periodId && m.status === 'CLOSED')).length
    group.open.sort((a, b) => b.missing.length - a.missing.length || a.label.localeCompare(b.label, 'es'))
  }
  return [...groups.values()].sort((a, b) => (a.closesOn ?? '9999').localeCompare(b.closesOn ?? '9999'))
}

/** Quién observó, como se nombra a cada parte del liceo (no el perfil de la persona). */
const REVIEWER: Record<string, string> = { DIRECCION: 'Dirección', ADSCRIPTO: 'Adscripción', ADMIN: 'Administración' }
const reviewerOf = (code: string | null | undefined) => (code ? (REVIEWER[code] ?? getRoleLabel(code)) : null)

export type LiveObservation = {
  gradeBookId: string
  label: string
  periodId: string
  meetingName: string
  sections: { section: string; label: string; text: string | null; by: string | null }[]
}

/** Lo observado que espera corrección, con el texto y quién lo observó. */
export function liveObservations(summaries: readonly OwnerSummary[], labelOf: (gradeBookId: string) => string): LiveObservation[] {
  return summaries.flatMap((summary) =>
    summary.meetings.flatMap((meeting) => {
      const review = meeting.review
      if (!review || review.blockingSections.length === 0 || review.reclosedAfterObservation) return []
      return [
        {
          gradeBookId: summary.gradeBookId,
          label: labelOf(summary.gradeBookId),
          periodId: meeting.periodId,
          meetingName: meeting.name,
          sections: review.blockingSections.map((section) => {
            const state = sectionState(review, section) as ReturnType<typeof sectionState> & { actorRoleCode?: string | null }
            return {
              section,
              label: ENDORSEMENT_SECTION_LABELS[section],
              text: state.observations,
              by: reviewerOf(state.actorRoleCode),
            }
          }),
        },
      ]
    }),
  )
}
