import { resolveLevel } from '../academic-config/grade-value.js'

/**
 * Cierre de período (RF-051, RF-052, RF-053).
 *
 * Todo acá es lógica pura: qué falta para poder cerrar, qué promedio sugerir y qué descriptor
 * corresponde. La persistencia vive en la ruta.
 */

export class PeriodClosureError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export type ScaleLevelRow = {
  id: string
  label: string
  descriptor: string | null
  minValueHundredths: number
  maxValueHundredths: number
  colorToken: string | null
  iconToken: string | null
  isPassing: boolean
  isAlert: boolean
}

export type PeriodRules = {
  /** Exige C, la calificación del docente. */
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
  /** Lleva reunión. Si además exige C, exige también R. */
  isMeeting?: boolean
}

export type StudentPeriodRow = {
  studentId: string
  lastName: string
  firstName: string
  /** Notas del período que cuentan para el promedio (las ausencias no entran). */
  assessmentValues: number[]
  /** C: la calificación del docente. */
  valueHundredths: number | null
  /** R: la nota que queda después de la reunión. */
  meetingValueHundredths?: number | null
  conceptualJudgement: string | null
}

/**
 * **La nota oficial del período es R**, la que queda después de la reunión: la usan el boletín,
 * el promedio de la reunión, la matriz y los indicadores. C es la que propone el docente y nunca
 * la reemplaza. Mientras no haya R, el período está pendiente para todo lo institucional.
 *
 * Es el único lugar donde vive la regla: cualquier lectura institucional pasa por acá.
 */
export function officialPeriodValue(
  grade: { meetingValueHundredths?: number | null } | null | undefined,
): number | null {
  return grade?.meetingValueHundredths ?? null
}

/** Escala con la que se ponen C y R: la numérica de cada nivel. */
export const PERIOD_SCALE_CODE_BY_LEVEL = { EBI: 'NUMERICA_1_10', EMS: 'NUMERICA_1_12' } as const

/** ¿El valor está fuera del rango de la escala? `null` (borrar) nunca lo está. */
export function isOutOfScale(
  value: number | null | undefined,
  scale: { minValueHundredths: number | null; maxValueHundredths: number | null } | null,
): boolean {
  if (value == null || !scale) return false
  if (scale.minValueHundredths != null && value < scale.minValueHundredths) return true
  return scale.maxValueHundredths != null && value > scale.maxValueHundredths
}

/** Sólo los tramos de trabajo admiten evaluaciones; entregas y diagnóstico no. */
export function acceptsAssessments(kind: 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA' | string): boolean {
  return kind === 'TRAMO'
}

type OrderedPeriod = { id: string; kind: string; sortOrder: number }

/**
 * Tramos que informa una entrega: los que quedan entre la entrega anterior y ella, en el orden de
 * la planilla. Cerrar la entrega los cierra también, porque una entrega cuyas notas de tramo
 * siguen editables dejaría de significar algo (mismo criterio que "un período cerrado congela sus
 * evaluaciones").
 */
export function periodsCoveredBy(target: OrderedPeriod, periods: readonly OrderedPeriod[]): string[] {
  if (target.kind !== 'ENTREGA') return []
  const previousEntrega = periods
    .filter((p) => p.kind === 'ENTREGA' && p.sortOrder < target.sortOrder)
    .reduce((max, p) => Math.max(max, p.sortOrder), Number.NEGATIVE_INFINITY)
  return periods
    .filter((p) => p.kind === 'TRAMO' && p.sortOrder > previousEntrega && p.sortOrder < target.sortOrder)
    .map((p) => p.id)
}

export type PeriodGradeInput = {
  valueHundredths?: number | null
  meetingValueHundredths?: number | null
  conceptualJudgement?: string | null
  conductValueHundredths?: number | null
}

const PERIOD_GRADE_FIELDS = [
  'valueHundredths',
  'meetingValueHundredths',
  'conceptualJudgement',
  'conductValueHundredths',
] as const satisfies ReadonlyArray<keyof PeriodGradeInput>

/**
 * Actualización parcial: lo que no viene (`undefined`) no se toca y `null` lo borra.
 *
 * La carta del docente guarda C, R y el informe celda por celda; si mandar sólo R borrara C, cada
 * cambio pisaría lo que la celda de al lado ya tenía.
 */
export function periodGradePatch(entry: PeriodGradeInput): PeriodGradeInput {
  const patch: PeriodGradeInput = {}
  for (const field of PERIOD_GRADE_FIELDS) {
    if (entry[field] !== undefined) (patch as Record<string, unknown>)[field] = entry[field]
  }
  return patch
}

// La libreta del docente NO promedia: el liceo es explícito y por eso acá no hay una función que
// lo haga. El promedio del grupo vive en `institutional.ts` (`transversalAverage`), que es donde el
// pliego lo pide y donde se usa para escolaridad y abanderados.

/** Descriptor y semáforo del valor, derivados de la escala al leer (RF-053). */
export function describeValue(valueHundredths: number | null, levels: readonly ScaleLevelRow[]) {
  const level = resolveLevel(valueHundredths, levels)
  if (!level) return null
  return {
    levelId: level.id,
    label: level.label,
    descriptor: level.descriptor,
    colorToken: level.colorToken,
    iconToken: level.iconToken,
    isPassing: level.isPassing,
    isAlert: level.isAlert,
  }
}

export type ClosureBlocker = {
  code: 'MISSING_GRADES' | 'MISSING_MEETING_GRADES' | 'MISSING_JUDGEMENT'
  studentIds: string[]
}

/**
 * Qué impide cerrar el período, según lo que exige su configuración (RF-052).
 *
 * Devuelve la lista de bloqueos en vez de lanzar al primero, para que la UI pueda marcar todas
 * las filas que faltan de una sola vez en lugar de hacer que el docente descubra los errores
 * de a uno.
 */
export function closureBlockers(
  students: readonly StudentPeriodRow[],
  rules: PeriodRules,
): ClosureBlocker[] {
  const blockers: ClosureBlocker[] = []

  if (rules.requiresGeneralGrade) {
    const missing = students.filter((s) => s.valueHundredths == null).map((s) => s.studentId)
    if (missing.length > 0) blockers.push({ code: 'MISSING_GRADES', studentIds: missing })
  }

  if (rules.requiresGeneralGrade && rules.isMeeting) {
    const missing = students.filter((s) => s.meetingValueHundredths == null).map((s) => s.studentId)
    if (missing.length > 0) blockers.push({ code: 'MISSING_MEETING_GRADES', studentIds: missing })
  }

  if (rules.requiresConceptualJudgement) {
    const missing = students
      .filter((s) => (s.conceptualJudgement ?? '').trim() === '')
      .map((s) => s.studentId)
    if (missing.length > 0) blockers.push({ code: 'MISSING_JUDGEMENT', studentIds: missing })
  }

  return blockers
}

export const CLOSURE_BLOCKER_MESSAGES: Record<ClosureBlocker['code'], string> = {
  MISSING_GRADES: 'Hay estudiantes sin calificación (C) del período.',
  MISSING_MEETING_GRADES: 'Hay estudiantes sin la nota de reunión (R).',
  MISSING_JUDGEMENT: 'Este período exige juicio conceptual y hay estudiantes sin él.',
}

/** ¿El cierre ocurre después de la fecha límite del período? (§5.9, cierres fuera de plazo) */
export function isLateClosure(closesOn: Date | null, now: Date): boolean {
  if (!closesOn) return false
  return now.getTime() > closesOn.getTime()
}

export type PeriodWriteBlock = 'CLOSED' | 'ARCHIVED' | null

/**
 * ¿Se puede escribir en este período?
 *
 * Un período cerrado congela también las **evaluaciones**, no sólo la calificación general: si no,
 * el docente podría cambiar una nota parcial después de cerrar y el cierre dejaría de significar
 * algo. Reabrirlo lo vuelve a habilitar.
 */
export function periodWriteBlock(params: {
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  gradeBookStatus: 'ACTIVE' | 'ARCHIVED'
}): PeriodWriteBlock {
  if (params.gradeBookStatus === 'ARCHIVED') return 'ARCHIVED'
  if (params.periodStatus === 'CLOSED') return 'CLOSED'
  return null
}

/**
 * ¿El calendario del período ya empezó?
 *
 * `startsOn` se guarda a mediodía UTC (`…T12:00:00.000Z`); el día civil es el
 * `YYYY-MM-DD` del ISO. Sin `startsOn` no hay candado de calendario.
 * `closesOn` no corta la edición: sólo marca el cierre como fuera de plazo.
 */
export function isPeriodCalendarOpen(params: {
  startsOn: Date | null | undefined
  /** Día civil institucional `YYYY-MM-DD`. */
  todayYmd: string
}): boolean {
  if (!params.startsOn) return true
  const startYmd = params.startsOn.toISOString().slice(0, 10)
  return params.todayYmd >= startYmd
}

/** ¿El docente puede cargar rendimiento/juicio en el cierre por alumno? */
export function canEditStudentClosurePeriod(params: {
  canGrade: boolean
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | string
  gradeBookStatus: 'ACTIVE' | 'ARCHIVED' | string
  startsOn: Date | null | undefined
  todayYmd: string
}): boolean {
  if (!params.canGrade) return false
  if (params.gradeBookStatus === 'ARCHIVED') return false
  if (params.periodStatus === 'CLOSED') return false
  return isPeriodCalendarOpen({ startsOn: params.startsOn, todayYmd: params.todayYmd })
}
