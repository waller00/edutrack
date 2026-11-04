import { ABSENCE_THRESHOLDS } from '../student-reports/rules.js'

/**
 * Quién necesita atención: una sola lista con los motivos de cada estudiante, por notas y por
 * faltas. Las reglas son las mismas de las otras pantallas, para que digan lo mismo:
 *
 * - **Notas:** tantas materias en tramo de alerta en el boletín de referencia como pide la regla
 *   "Asignaturas en alerta" del ciclo (3 por defecto), igual que la reunión de profesores; o deber
 *   materias de años anteriores.
 * - **Faltas:** llegar a las 18 faltas (contadas como el boletín), o faltas seguidas que siguen.
 *
 * Es informativo: no decide promociones ni sanciones.
 */

export type RiskReason = 'GRADES' | 'ABSENCES' | 'STREAK' | 'CARRIED'
export type RiskFamily = 'NOTAS' | 'FALTAS'

export type RiskStudent = {
  studentId: string
  firstName: string
  lastName: string
  courseName: string
  level: string | null
}

export type RiskInput = RiskStudent & {
  /** Materias en tramo de alerta en el boletín de referencia de su nivel; null si no tiene notas. */
  lowSubjects: { count: number; subjects: string[]; periodName: string } | null
  absenceHundredths: number
  /** Racha de faltas seguidas que todavía sigue, si tiene. */
  openStreak: { days: number; from: string } | null
  /** Materias de años anteriores que todavía debe. */
  carried: number
}

export type RiskRow = RiskStudent & {
  grades: { lowSubjects: number; subjects: string[]; periodName: string } | null
  absenceHundredths: number
  /** El umbral de faltas más alto alcanzado (1800 o 2500), o null. */
  absenceThreshold: number | null
  streak: { days: number; from: string } | null
  carried: number
  reasons: RiskReason[]
  families: RiskFamily[]
}

export type RiskCounts = { students: number; grades: number; absences: number; both: number }

const [WARNING, CRITICAL] = ABSENCE_THRESHOLDS

function reasonsOf(input: RiskInput, threshold: number): RiskReason[] {
  const reasons: RiskReason[] = []
  if (input.lowSubjects && input.lowSubjects.count >= threshold) reasons.push('GRADES')
  if (input.carried > 0) reasons.push('CARRIED')
  if (input.absenceHundredths >= WARNING) reasons.push('ABSENCES')
  if (input.openStreak) reasons.push('STREAK')
  return reasons
}

function familiesOf(reasons: readonly RiskReason[]): RiskFamily[] {
  const families: RiskFamily[] = []
  if (reasons.includes('GRADES') || reasons.includes('CARRIED')) families.push('NOTAS')
  if (reasons.includes('ABSENCES') || reasons.includes('STREAK')) families.push('FALTAS')
  return families
}

/** Primero quien tiene notas y faltas; después 25 faltas, más materias bajas, más faltas, la racha. */
export function compareRisk(a: RiskRow, b: RiskRow): number {
  const critical = (row: RiskRow) => (row.absenceHundredths >= CRITICAL ? 1 : 0)
  return (
    b.families.length - a.families.length ||
    critical(b) - critical(a) ||
    (b.grades?.lowSubjects ?? 0) - (a.grades?.lowSubjects ?? 0) ||
    b.absenceHundredths - a.absenceHundredths ||
    (b.streak?.days ?? 0) - (a.streak?.days ?? 0) ||
    a.lastName.localeCompare(b.lastName, 'es') ||
    a.firstName.localeCompare(b.firstName, 'es')
  )
}

/**
 * Filas de quienes tienen algún motivo, ordenadas. `threshold` es la regla de asignaturas en
 * alerta (infinito si está apagada: entonces las notas sólo cuentan por materias de años anteriores).
 */
export function riskRows(inputs: readonly RiskInput[], threshold: number): RiskRow[] {
  const rows: RiskRow[] = []
  for (const input of inputs) {
    const reasons = reasonsOf(input, threshold)
    if (reasons.length === 0) continue
    rows.push({
      studentId: input.studentId,
      firstName: input.firstName,
      lastName: input.lastName,
      courseName: input.courseName,
      level: input.level,
      grades: input.lowSubjects
        ? { lowSubjects: input.lowSubjects.count, subjects: input.lowSubjects.subjects, periodName: input.lowSubjects.periodName }
        : null,
      absenceHundredths: input.absenceHundredths,
      absenceThreshold: ABSENCE_THRESHOLDS.filter((t) => input.absenceHundredths >= t).at(-1) ?? null,
      streak: input.openStreak,
      carried: input.carried,
      reasons,
      families: familiesOf(reasons),
    })
  }
  return rows.sort(compareRisk)
}

export function riskCounts(rows: readonly RiskRow[]): RiskCounts {
  let grades = 0
  let absences = 0
  let both = 0
  for (const row of rows) {
    const notas = row.families.includes('NOTAS')
    const faltas = row.families.includes('FALTAS')
    if (notas) grades++
    if (faltas) absences++
    if (notas && faltas) both++
  }
  return { students: rows.length, grades, absences, both }
}

export type ReferenceCandidate = { id: string; name: string; level: string | null; sortOrder: number; graded: number }

/**
 * El boletín de referencia de cada nivel: el pedido si es de ese nivel; si no, el último que ya
 * tiene notas; sin notas, ninguno (no hay con qué marcar a nadie por notas).
 */
export function pickReferencePeriods(
  candidates: readonly ReferenceCandidate[],
  requestedId?: string | null,
): Map<string | null, ReferenceCandidate | null> {
  const byLevel = new Map<string | null, ReferenceCandidate | null>()
  for (const level of new Set(candidates.map((c) => c.level))) {
    const ofLevel = candidates.filter((c) => c.level === level)
    const requested = ofLevel.find((c) => c.id === requestedId)
    const latest = ofLevel.filter((c) => c.graded > 0).sort((a, b) => b.sortOrder - a.sortOrder)[0] ?? null
    byLevel.set(level, requested ?? latest)
  }
  return byLevel
}
