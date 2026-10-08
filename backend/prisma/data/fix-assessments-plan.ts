/**
 * Qué corregir en las evaluaciones que se cargaron antes de que la libreta distinguiera notas
 * sueltas y usara la escala del nivel. Lógica pura: el script `fix-gradebook-assessments.ts` la
 * alimenta con la base y aplica lo que devuelve.
 */

export type AssessmentRow = {
  id: string
  title: string
  /** Día civil YYYY-MM-DD. */
  date: string
  source: 'MANUAL' | 'MOODLE_IMPORT'
  scope: 'GROUP' | 'INDIVIDUAL'
  level: string | null
  scaleCode: string
  activityTypeName: string | null
  /** Las notas cargadas (alcanza con traer hasta dos para saber si es una sola). */
  grades: ReadonlyArray<{ comment: string | null }>
}

export type AssessmentFixPlan = {
  /** Notas sueltas de la carta que quedaron como evaluación del grupo. */
  toIndividual: string[]
  /** Evaluaciones manuales de bachillerato creadas con la escala 1–10. */
  toEmsScale: string[]
}

export const EBI_SCALE_CODE = 'NUMERICA_1_10'
export const EMS_SCALE_CODE = 'NUMERICA_1_12'

/**
 * ¿La creó la carta del alumno? Una sola nota y el título que la carta arma: el comentario, o
 * "<tipo de actividad> — <fecha>" si no lo había. La planilla del grupo pide un título propio.
 */
export function isCardNote(row: AssessmentRow): boolean {
  if (row.source !== 'MANUAL' || row.grades.length !== 1) return false
  const comment = row.grades[0].comment?.trim() ?? ''
  const generated = `${row.activityTypeName ?? 'Evaluación'} — ${row.date}`
  return row.title === generated || (comment !== '' && row.title === comment)
}

/**
 * Una evaluación manual de bachillerato con la escala 1–10 se creó así porque la libreta no
 * ofrecía otra. Sus notas (1 a 10) son válidas en 1–12. Las de Moodle no se tocan: se convirtieron
 * proporcionalmente a la escala elegida, y cambiarla les cambiaría el sentido.
 */
export function needsEmsScale(row: AssessmentRow): boolean {
  return row.source === 'MANUAL' && row.level === 'EMS' && row.scaleCode === EBI_SCALE_CODE
}

export function planAssessmentFixes(rows: readonly AssessmentRow[]): AssessmentFixPlan {
  return {
    toIndividual: rows.filter((row) => row.scope === 'GROUP' && isCardNote(row)).map((row) => row.id),
    toEmsScale: rows.filter(needsEmsScale).map((row) => row.id),
  }
}
