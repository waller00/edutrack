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
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
}

export type StudentPeriodRow = {
  studentId: string
  lastName: string
  firstName: string
  /** Notas del período que cuentan para el promedio (las ausencias no entran). */
  assessmentValues: number[]
  valueHundredths: number | null
  conceptualJudgement: string | null
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
  code: 'MISSING_GRADES' | 'MISSING_JUDGEMENT'
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

  if (rules.requiresConceptualJudgement) {
    const missing = students
      .filter((s) => (s.conceptualJudgement ?? '').trim() === '')
      .map((s) => s.studentId)
    if (missing.length > 0) blockers.push({ code: 'MISSING_JUDGEMENT', studentIds: missing })
  }

  return blockers
}

export const CLOSURE_BLOCKER_MESSAGES: Record<ClosureBlocker['code'], string> = {
  MISSING_GRADES: 'Hay estudiantes sin calificación general del período.',
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
