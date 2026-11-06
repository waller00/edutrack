/**
 * El panel del alumno en la Reunión de profesores (`GET /admin/gradebook/group-matrix/students/:id`):
 * cada materia con su detalle y las faltas del liceo desglosadas. Acá viven los textos y las
 * cuentas, para que el panel sólo dibuje.
 */

import { formatAbsenceUnits } from '@/lib/libreta/absences'
import { formatGrade } from './grade-scale'
import { hasRollCalls, markCountParts, type MarkCounts } from './subject-attendance'

export type MeetingStudentAssessment = {
  id: string
  title: string
  /** Día civil, `YYYY-MM-DD`. */
  date: string
  periodName: string
  scope: string
  valueHundredths: number | null
  isAbsent: boolean
  levelLabel: string | null
  comment: string | null
  /** Sin fila de nota para el alumno. */
  missing: boolean
}

export type MeetingStudentDescriptor = {
  label: string
  descriptor: string | null
  colorToken: string | null
  iconToken: string | null
  isAlert: boolean
} | null

export type MeetingStudentSubject = {
  gradeBookId: string
  subjectId: string
  name: string
  teacher: string | null
  periodStatus: string | null
  valueHundredths: number | null
  descriptor: MeetingStudentDescriptor
  proposedValueHundredths: number | null
  conductValueHundredths: number | null
  conceptualJudgement: string | null
  previousValueHundredths: number | null
  assessments: MeetingStudentAssessment[]
  attendance: { period: MarkCounts | null; year: MarkCounts }
}

export type MeetingStudentAbsences = {
  hundredths: number
  /** Las que van al boletín: las fictas redondeadas para abajo. */
  whole: number
  unjustified: number
  justified: number
  lates: number
}

export type MeetingStudent = {
  student: { studentId: string; lastName: string; firstName: string }
  period: { id: string; name: string }
  previousPeriod: { id: string; name: string } | null
  absences: MeetingStudentAbsences
  subjects: MeetingStudentSubject[]
}

export type GradeChange = {
  direction: 'up' | 'down' | 'same'
  /** Flecha y palabra: el cambio nunca es sólo color (RNF 7.2). */
  symbol: '↑' | '↓' | '='
  word: 'subió' | 'bajó' | 'igual'
  /** «6 → 4». */
  text: string
}

/** Cómo cambió la R respecto de la reunión anterior; `null` si falta alguna de las dos. */
export function gradeChange(previous: number | null | undefined, current: number | null | undefined): GradeChange | null {
  if (previous == null || current == null) return null
  const text = `${formatGrade(previous)} → ${formatGrade(current)}`
  if (current > previous) return { direction: 'up', symbol: '↑', word: 'subió', text }
  if (current < previous) return { direction: 'down', symbol: '↓', word: 'bajó', text }
  return { direction: 'same', symbol: '=', word: 'igual', text }
}

/** «8», «No rindió», el tramo de una escala sin números, o «Sin nota». */
export function assessmentResult(a: Pick<MeetingStudentAssessment, 'valueHundredths' | 'isAbsent' | 'levelLabel' | 'missing'>): string {
  if (a.isAbsent) return 'No rindió'
  if (a.valueHundredths != null) return formatGrade(a.valueHundredths)
  return a.levelLabel ?? 'Sin nota'
}

/** `2026-05-02` → «02/05». */
export function shortDate(ymd: string): string {
  const [, month, day] = ymd.split('-')
  return day && month ? `${day}/${month}` : ymd
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** «3 faltas en 20 clases», «Sin faltas en 20 clases» o «Sin listas»: el resumen de la fila. */
export function subjectAbsenceSummary(counts: MarkCounts | null | undefined): string {
  if (!hasRollCalls(counts)) return 'Sin listas'
  const absences = counts.absent + counts.justified
  const classes = plural(counts.classes, 'clase', 'clases')
  const base = absences === 0 ? `Sin faltas en ${classes}` : `${plural(absences, 'falta', 'faltas')} en ${classes}`
  return counts.late > 0 ? `${base} · ${plural(counts.late, 'tarde', 'tardes')}` : base
}

/** «2 sin justificar, 1 justificada y 1 llegada tarde, de 20 clases con lista». */
export function subjectAbsenceDetail(counts: MarkCounts | null | undefined): string {
  if (!hasRollCalls(counts)) return 'Todavía no se pasó lista con el alumno.'
  const parts = markCountParts(counts).map((part) => `${part.count} ${part.label}`)
  const classes = `${plural(counts.classes, 'clase', 'clases')} con lista`
  if (parts.length === 0) return `Sin faltas, de ${classes}.`
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
  return `${list}, de ${classes}.`
}

export type SchoolAbsenceSummary = {
  /** «14,5»: las fictas, como la columna Faltas. */
  total: string
  /** Lo que dice el boletín. */
  reportCard: number
  parts: Array<{ count: number; label: string }>
}

/** Las faltas del liceo con el desglose por día, como el boletín (J, I y tardes). */
export function schoolAbsenceSummary(absences: MeetingStudentAbsences): SchoolAbsenceSummary {
  return {
    total: formatAbsenceUnits(absences.hundredths),
    reportCard: absences.whole,
    parts: [
      { count: absences.unjustified, label: absences.unjustified === 1 ? 'día sin justificar' : 'días sin justificar' },
      { count: absences.justified, label: absences.justified === 1 ? 'día justificado' : 'días justificados' },
      { count: absences.lates, label: absences.lates === 1 ? 'llegada tarde' : 'llegadas tarde' },
    ],
  }
}

/**
 * El anterior y el siguiente en la lista que deja el filtro. Si el alumno ya no está en ella
 * (se le puso el rendimiento con «Sin rendimiento» elegido), se sigue desde su lugar en la lista
 * completa: la reunión no vuelve al principio.
 */
export function neighbors<T extends { studentId: string }>(
  visible: readonly T[],
  all: readonly T[],
  studentId: string,
): { previous: T | null; next: T | null } {
  const order = new Map(all.map((row, index) => [row.studentId, index]))
  const at = order.get(studentId)
  if (at == null) return { previous: null, next: null }
  const before = visible.filter((row) => (order.get(row.studentId) ?? -1) < at)
  const after = visible.find((row) => (order.get(row.studentId) ?? -1) > at)
  return { previous: before[before.length - 1] ?? null, next: after ?? null }
}

/** Cuántas materias están en el tramo de alerta y cuántas todavía no tienen R. */
export function subjectCounts(subjects: readonly MeetingStudentSubject[]): { alert: number; pending: number; declined: number } {
  return {
    alert: subjects.filter((s) => s.descriptor?.isAlert).length,
    pending: subjects.filter((s) => s.valueHundredths == null).length,
    declined: subjects.filter((s) => gradeChange(s.previousValueHundredths, s.valueHundredths)?.direction === 'down').length,
  }
}
