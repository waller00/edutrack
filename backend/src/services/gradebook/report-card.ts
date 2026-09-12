/**
 * Boletín del estudiante: lo que recibe la familia al cerrar un período.
 *
 * Es la **única** salida transversal del sistema. Todo lo que se exporta hoy —XLSX y PDF— es por
 * libreta, o sea de una sola materia, y un boletín es exactamente lo contrario: un estudiante con
 * todas sus asignaturas.
 *
 * Este archivo arma el contenido; el PDF lo dibuja `exports/reportCardPdf.ts`. La separación es la
 * de siempre en el repo: la lógica queda testeable sin generar un binario.
 */

export type ReportCardSubject = {
  subjectName: string
  teacherName: string | null
  valueHundredths: number | null
  descriptor: string | null
  conceptualJudgement: string | null
  conductValueHundredths: number | null
}

export type ReportCardInput = {
  student: {
    firstName: string
    lastName: string
    documentId: string | null
    birthDate: Date | null
  }
  group: { courseName: string; orientationName: string | null; schoolYearLabel: string }
  period: { name: string }
  subjects: readonly ReportCardSubject[]
  /** Conducta institucional del período, la que pone adscripción. */
  conductValueHundredths: number | null
  attendance: { absenceHundredths: number; justifiedCount: number }
}

/**
 * Promedio de rendimiento del período, en centésimos.
 *
 * Sólo promedia lo calificado: una asignatura todavía sin nota **no** arrastra el promedio hacia
 * abajo — "no tiene nota" no es "sacó cero". Es el mismo criterio que la matriz institucional.
 */
export function reportCardAverage(subjects: readonly ReportCardSubject[]): number | null {
  const values = subjects
    .map((s) => s.valueHundredths)
    .filter((v): v is number => v != null)
  if (values.length === 0) return null
  return Math.round(values.reduce((acc, v) => acc + v, 0) / values.length)
}

/**
 * Formatea el promedio con **al menos un decimal**.
 *
 * El liceo lo pidió explícitamente: se usa para la escolaridad y para elegir abanderados, donde un
 * entero no alcanza para desempatar dos estudiantes.
 */
export function formatAverage(hundredths: number | null, decimals = 1): string {
  if (hundredths == null) return '—'
  return (hundredths / 100).toFixed(Math.max(1, decimals)).replace('.', ',')
}

/** Cuántas asignaturas todavía no tienen nota. Es lo que explica un promedio parcial. */
export function pendingSubjectCount(subjects: readonly ReportCardSubject[]): number {
  return subjects.filter((s) => s.valueHundredths == null).length
}

export type ReportCard = ReportCardInput & {
  averageHundredths: number | null
  pendingCount: number
}

export function buildReportCard(input: ReportCardInput): ReportCard {
  return {
    ...input,
    averageHundredths: reportCardAverage(input.subjects),
    pendingCount: pendingSubjectCount(input.subjects),
  }
}
