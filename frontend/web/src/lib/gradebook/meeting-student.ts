/**
 * El panel del alumno en la Reunión de profesores (`GET /admin/gradebook/group-matrix/students/:id`):
 * cada materia con su detalle y las faltas del liceo desglosadas. Acá viven los textos y las
 * cuentas, para que el panel sólo dibuje.
 */

import { formatAbsenceUnits } from '@/lib/libreta/absences'
import { formatGrade, gradeChoices, gradeSelectOptions, type GradeRange } from './grade-scale'
import { hasRollCalls, markCountParts, type MarkCounts } from './subject-attendance'

/** La escala de una evaluación: la corrección ofrece sus opciones (números o tramos). */
export type AssessmentScale = {
  kind: 'NUMERIC' | 'ORDINAL'
  minValueHundredths: number | null
  maxValueHundredths: number | null
  levels: Array<{ id: string; label: string }>
}

export type MeetingStudentAssessment = {
  id: string
  title: string
  /** Día civil, `YYYY-MM-DD`. */
  date: string
  /** El tramo de la evaluación: el panel las agrupa por tramo. */
  periodId?: string
  periodName: string
  scale?: AssessmentScale | null
  scaleLevelId?: string | null
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
  /** Rango de la R (la escala del nivel) y opciones de la C: lo que ofrece la corrección. */
  periodScale?: GradeRange | null
  conductOptions?: Array<{ valueHundredths: number; label: string }>
  /** Administración: corrige desde el panel, aunque la libreta esté cerrada. */
  canCorrect?: boolean
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
 * El anterior y el siguiente en la lista que deja el filtro. Si el alumno ya no está en ella (se le
 * escribió el juicio con «Sin juicio» elegido), se sigue desde su lugar en la lista completa: la
 * reunión no vuelve al principio.
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

export type TramoGroup = { periodId: string; periodName: string; assessments: MeetingStudentAssessment[] }

/**
 * Las evaluaciones del período agrupadas por tramo, en el orden en que llegan (por fecha): así se
 * leen las notas de cada tramo que informa la reunión.
 */
export function assessmentsByTramo(assessments: readonly MeetingStudentAssessment[]): TramoGroup[] {
  const groups: TramoGroup[] = []
  for (const assessment of assessments) {
    const key = assessment.periodId ?? assessment.periodName
    let group = groups.find((g) => g.periodId === key)
    if (!group) {
      group = { periodId: key, periodName: assessment.periodName, assessments: [] }
      groups.push(group)
    }
    group.assessments.push(assessment)
  }
  return groups
}

export type Choice = { value: string; label: string }

/**
 * Las opciones para corregir una nota: los números de la escala (con la nota actual aunque tenga
 * decimales, para que tocar el selector no la borre) o los tramos de una escala sin números.
 */
export function assessmentChoices(scale: AssessmentScale | null | undefined, current: number | null): Choice[] {
  if (scale?.kind === 'ORDINAL') return scale.levels.map((level) => ({ value: level.id, label: level.label }))
  const range = scale ? { minValueHundredths: scale.minValueHundredths, maxValueHundredths: scale.maxValueHundredths } : null
  return gradeSelectOptions(range, current).map((v) => ({ value: String(v), label: formatGrade(v) }))
}

/** Las notas enteras de la escala del nivel, para corregir la R. */
export function performanceChoices(scale: GradeRange | null | undefined): Choice[] {
  return gradeChoices(scale).map((v) => ({ value: String(v), label: formatGrade(v) }))
}

/** El motivo es obligatorio: queda en la revisión, en la auditoría y en el aviso al docente. */
export function correctionReasonError(reason: string): string | null {
  return reason.trim().length >= 3 ? null : 'Escribí el motivo de la corrección.'
}

export type CorrectionTarget =
  | { kind: 'assessment'; gradeBookId: string; studentId: string; assessment: MeetingStudentAssessment }
  | { kind: 'performance' | 'conduct'; gradeBookId: string; periodId: string; studentId: string; current: number | null }
  | { kind: 'judgement'; gradeBookId: string; periodId: string; studentId: string; current: string | null }

export type CorrectionValues = {
  /** Valor elegido: centésimos, el id de un tramo, o `''` para dejarla sin nota. */
  value: string
  isAbsent: boolean
  comment: string
  /** El juicio del docente. */
  text: string
  reason: string
}

/** Qué se le manda al sistema para cada corrección. */
export function correctionRequest(target: CorrectionTarget, values: CorrectionValues): { path: string; body: Record<string, unknown> } {
  const base = `/admin/gradebook/corrections/gradebooks/${target.gradeBookId}`
  const reason = values.reason.trim()
  if (target.kind === 'assessment') {
    const ordinal = target.assessment.scale?.kind === 'ORDINAL'
    const chosen = values.value === '' ? null : values.value
    return {
      path: `${base}/assessments/${target.assessment.id}/students/${target.studentId}`,
      body: {
        valueHundredths: ordinal || chosen == null ? null : Number(chosen),
        scaleLevelId: ordinal ? chosen : null,
        isAbsent: values.isAbsent,
        comment: values.comment.trim() || null,
        reason,
      },
    }
  }
  const path = `${base}/periods/${target.periodId}/students/${target.studentId}`
  if (target.kind === 'judgement') return { path, body: { conceptualJudgement: values.text.trim() || null, reason } }
  const number = values.value === '' ? null : Number(values.value)
  return { path, body: { [target.kind === 'performance' ? 'meetingValueHundredths' : 'conductValueHundredths']: number, reason } }
}

/** Lo que dice la corrección arriba del formulario: qué se corrige. */
export function correctionTitle(target: CorrectionTarget): string {
  switch (target.kind) {
    case 'assessment':
      return `Corregir la nota de «${target.assessment.title}»`
    case 'performance':
      return 'Corregir la R'
    case 'conduct':
      return 'Corregir la C'
    default:
      return 'Corregir el juicio del docente'
  }
}

/** Con qué arranca el formulario: lo que hay cargado. */
export function initialCorrection(target: CorrectionTarget): CorrectionValues {
  const empty = { value: '', isAbsent: false, comment: '', text: '', reason: '' }
  if (target.kind === 'assessment') {
    const a = target.assessment
    const value = a.scale?.kind === 'ORDINAL' ? a.scaleLevelId ?? '' : a.valueHundredths == null ? '' : String(a.valueHundredths)
    return { ...empty, value, isAbsent: a.isAbsent, comment: a.comment ?? '' }
  }
  if (target.kind === 'judgement') return { ...empty, text: target.current ?? '' }
  return { ...empty, value: target.current == null ? '' : String(target.current) }
}
