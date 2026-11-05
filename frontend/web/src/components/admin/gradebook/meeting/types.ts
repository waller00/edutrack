import type { ConductOption } from '@/components/gradebook/ConductSelect'
import type { GradeRange } from '@/lib/gradebook/grade-scale'

export type MatrixDescriptor = {
  label: string
  descriptor: string | null
  colorToken: string | null
  iconToken: string | null
  isAlert: boolean
} | null

export type MatrixCellData = {
  gradeBookId: string
  /** R, el rendimiento: la nota oficial. */
  valueHundredths: number | null
  /** C, la del docente. Se muestra como propuesta mientras no hay R; no promedia. */
  proposedValueHundredths?: number | null
  conceptualJudgement: string | null
  descriptor: MatrixDescriptor
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  pending: boolean
}

export type MatrixRow = {
  studentId: string
  lastName: string
  firstName: string
  cells: MatrixCellData[]
  averageHundredths: number | null
  /** Conducta institucional del período, la que pone adscripción. */
  conductValueHundredths?: number | null
  /** Rendimiento general que eligió la reunión. El promedio es sólo su referencia. */
  performanceValueHundredths?: number | null
  /** Faltas del ciclo en todo el liceo, en centésimos. */
  absenceHundredths?: number
  pendingCount: number
  alertCount: number
  atRisk: boolean
}

export type MatrixSubject = { gradeBookId: string; name: string; teacher: string | null; periodStatus: string | null }

export type Matrix = {
  group: { courseName: string; schoolYear: { id?: string; label: string } }
  subjects: MatrixSubject[]
  students: MatrixRow[]
  averageLabel: string
  /** Decimales del promedio. El liceo lo pide con al menos uno: escolaridad y abanderados. */
  averageDecimals?: number
  /** Asignaturas en alerta que marcan al estudiante; `null` si la regla está apagada. */
  alertSubjectsThreshold?: number | null
  /** Tramos de la escala de conducta: rotulan la columna y son las opciones al cargarla. */
  conductLevels?: ConductOption[]
  /** Rango del rendimiento de la reunión: la escala del nivel (1–10 EBI, 1–12 EMS). */
  performanceScale?: GradeRange | null
}

/** Cómo va el guardado de cada casillero: lo que se eligió se ve guardándose, guardado o rechazado. */
export type SaveStatus = 'saving' | 'saved' | 'error'
