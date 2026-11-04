import { blockerText, openingMeeting, studentList, type MeetingSummary } from './closure-blockers'
import { ENDORSEMENT_SECTION_LABELS } from './endorsements'
import { meetingStage, type MeetingStage } from './meeting-stage'

/**
 * En qué está cada libreta del docente (`GET /gradebook/mine/summary`), para su tarjeta en Mis
 * libretas y para su Inicio: la reunión que viene, su plazo, la etapa (Cargar → Cerrar → Revisión →
 * Visada), qué falta y de quiénes, y lo que le observaron.
 */

type Student = { studentId: string; lastName: string; firstName: string }

export type OwnerSummary = { gradeBookId: string; role: 'OWNER'; meetings: MeetingSummary[]; students: Student[] }
export type LibretaSummary = OwnerSummary | { gradeBookId: string; role: 'SUBSTITUTE'; until: string | null }

export type CardStatus = {
  meeting: { periodId: string; name: string }
  /** «cierra el 14/11»; vencido si el plazo ya pasó y no está cerrada. */
  deadline: { text: string; overdue: boolean } | null
  stage: MeetingStage
  /** «3 sin R (rendimiento): Pérez, Ana · Gómez, Beto y 1 más». */
  missing: string[]
  /** «Observaron los juicios»: lo que espera corrección. */
  observed: string | null
}

const dayMonth = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`

export function meetingStageOf(meeting: MeetingSummary): MeetingStage {
  return meetingStage(
    {
      periodStatus: meeting.status,
      missing: meeting.missing ? meeting.missing.length : null,
      closedAt: meeting.closedAt,
      reopenReason: meeting.reopenReason,
      endorsement: meeting.review ? { ...meeting.review, periodStatus: meeting.status } : null,
    },
    'teacher',
  )
}

function deadlineOf(meeting: MeetingSummary, todayYmd: string): CardStatus['deadline'] {
  if (meeting.status === 'CLOSED' || !meeting.closesOn) return null
  const overdue = meeting.closesOn.slice(0, 10) < todayYmd
  return { text: `${overdue ? 'venció el' : 'cierra el'} ${dayMonth(meeting.closesOn)}`, overdue }
}

/** «Observaron los juicios y la planificación y desarrollo». */
export function observedText(meeting: MeetingSummary): string | null {
  const sections = meeting.review?.blockingSections ?? []
  if (sections.length === 0 || meeting.review?.reclosedAfterObservation) return null
  const names = sections.map((section) => ENDORSEMENT_SECTION_LABELS[section].toLowerCase())
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0]
  return `Observaron: ${list}`
}

export function missingTexts(meeting: MeetingSummary, students: readonly Student[]): string[] {
  return (meeting.missing ?? []).map((blocker) => {
    const text = blockerText(blocker)
    return blocker.studentIds.length > 0 ? `${text}: ${studentList(blocker.studentIds, students)}` : text
  })
}

/** La reunión que importa ahora: la primera sin cerrar; con todas cerradas, la última. */
export function cardStatus(summary: OwnerSummary, todayYmd: string): CardStatus | null {
  const meeting = openingMeeting(summary.meetings)
  if (!meeting) return null
  return {
    meeting: { periodId: meeting.periodId, name: meeting.name },
    deadline: deadlineOf(meeting, todayYmd),
    stage: meetingStageOf(meeting),
    missing: missingTexts(meeting, summary.students),
    observed: observedText(meeting),
  }
}

/** El resumen de cada libreta por su id; las suplencias no traen estado. */
export function ownerSummaries(rows: readonly LibretaSummary[] | undefined): Map<string, OwnerSummary> {
  return new Map((rows ?? []).flatMap((row) => (row.role === 'OWNER' ? [[row.gradeBookId, row] as const] : [])))
}
