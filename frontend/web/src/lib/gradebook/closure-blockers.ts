import type { EndorsementSectionState, EndorsementSection, EndorsementStatus } from './endorsements'

/**
 * Lo que falta para cerrar una reunión, como lo devuelve el backend (`meetingReadiness`): la misma
 * cuenta del cierre y del control de administración. Lo usan el panel de cierre de la libreta, la
 * lista de libretas y el Inicio del docente.
 */

export type BlockerCode =
  | 'MISSING_GRADES'
  | 'MISSING_CONDUCT'
  | 'MISSING_JUDGEMENT'
  | 'MISSING_GROUP_REPORT'
  | 'NO_ASSESSMENTS'
  | 'STUDENTS_WITHOUT_GRADES'
  | 'MISSING_ASSESSMENT_GRADES'

export type Blocker = { code: BlockerCode; studentIds: string[]; slots?: number }

/** Una reunión de una libreta (`GET /gradebook/:id/meetings`). */
export type MeetingSummary = {
  periodId: string
  name: string
  kind: 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA' | string
  sortOrder: number
  reportCard: boolean
  judgementLabel: string | null
  closesOn: string | null
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  closedAt: string | null
  closedLate: boolean
  reopenReason: string | null
  /** Lo que falta para cerrarla; `null` si está cerrada. */
  missing: Blocker[] | null
  review: {
    sections: (EndorsementSectionState & { actorRoleCode?: string | null })[]
    overallStatus: EndorsementStatus
    blockingSections: EndorsementSection[]
    reclosedAfterObservation: boolean
  } | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Lo que falta, en una frase corta con su número: «3 sin R (rendimiento)». */
export function blockerText(blocker: Blocker): string {
  const students = blocker.studentIds.length
  switch (blocker.code) {
    case 'MISSING_GRADES':
      return `${students} sin R (rendimiento)`
    case 'MISSING_CONDUCT':
      return `${students} sin C (conducta)`
    case 'MISSING_JUDGEMENT':
      return `${students} sin informe o juicio`
    case 'MISSING_GROUP_REPORT':
      return 'falta el informe del grupo'
    case 'NO_ASSESSMENTS':
      return 'no hay evaluaciones en los tramos'
    case 'STUDENTS_WITHOUT_GRADES':
      return plural(students, 'sin ninguna nota en el tramo', 'sin ninguna nota en el tramo')
    default:
      return `${plural(blocker.slots ?? students, 'nota sin cargar', 'notas sin cargar')} en evaluaciones del grupo (${plural(students, 'estudiante', 'estudiantes')})`
  }
}

/** El título de cada faltante en el panel. */
export function blockerTitle(code: BlockerCode, judgementLabel?: string | null): string {
  switch (code) {
    case 'MISSING_GRADES':
      return 'R (rendimiento)'
    case 'MISSING_CONDUCT':
      return 'C (conducta)'
    case 'MISSING_JUDGEMENT':
      return judgementLabel?.trim() || 'Juicio'
    case 'MISSING_GROUP_REPORT':
      return 'Informe del grupo'
    case 'NO_ASSESSMENTS':
      return 'Evaluaciones'
    case 'STUDENTS_WITHOUT_GRADES':
      return 'Sin notas en el tramo'
    default:
      return 'Notas de evaluaciones del grupo'
  }
}

/** Lo que se completa en Calificaciones, no en el cierre: las notas de las evaluaciones. */
export function fixedInGrades(code: BlockerCode): boolean {
  return code === 'NO_ASSESSMENTS' || code === 'STUDENTS_WITHOUT_GRADES' || code === 'MISSING_ASSESSMENT_GRADES'
}

/** El 409 del cierre trae la lista completa de faltantes en `detail.blockers`. */
export function closeErrorText(err: unknown): string {
  const data = (err as { data?: { message?: string; detail?: { blockers?: Blocker[] } } })?.data
  const blockers = data?.detail?.blockers ?? []
  if (blockers.length > 0) return `No se puede cerrar todavía: ${blockers.map(blockerText).join(' · ')}.`
  return data?.message ?? (err instanceof Error ? err.message : 'No se pudo cerrar')
}

/**
 * La reunión que se abre desplegada: la pedida (un aviso la manda con `?periodId=`), si no la
 * primera sin cerrar, y si están todas cerradas, la última.
 */
export function openingMeeting<T extends { status: string; periodId?: string }>(meetings: readonly T[], preferredId?: string | null): T | null {
  const preferred = preferredId ? meetings.find((meeting) => meeting.periodId === preferredId) : undefined
  return preferred ?? meetings.find((meeting) => meeting.status !== 'CLOSED') ?? meetings.at(-1) ?? null
}

/** «Pérez, Ana · Gómez, Beto y 3 más», con los nombres del grupo. */
export function studentList(
  ids: readonly string[],
  students: readonly { studentId: string; lastName: string; firstName: string }[],
  shown = 3,
): string {
  const names = new Map(students.map((s) => [s.studentId, `${s.lastName}, ${s.firstName}`]))
  const listed = ids.slice(0, shown).map((id) => names.get(id) ?? 'Alumno')
  const rest = ids.length - listed.length
  return rest > 0 ? `${listed.join(' · ')} y ${rest} más` : listed.join(' · ')
}
