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
}
