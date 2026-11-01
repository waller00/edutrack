import { wholeAbsences, type AbsenceCounts } from '../student-attendance/absence-weight.js'
import { assessmentPeriodsFor, officialPeriodValue } from './period-closure.js'

/**
 * Boletín del estudiante: lo que recibe la familia después de cada reunión de boletín.
 *
 * Es la **única** salida transversal del sistema. Todo lo que se exporta hoy —XLSX y PDF— es por
 * libreta, o sea de una sola materia, y un boletín es exactamente lo contrario: un estudiante con
 * todas sus asignaturas.
 *
 * Sigue la planilla impresa del liceo: por asignatura C (conducta), R (rendimiento) y el informe de
 * actuación; abajo el juicio de la reunión y las inasistencias. No lleva promedio: ése vive en la
 * matriz y en la planilla de reunión.
 *
 * Este archivo arma el contenido; el PDF lo dibuja `exports/reportCardPdf.ts`. La separación es la
 * de siempre en el repo: la lógica queda testeable sin generar un binario.
 */

export type ReportCardSubject = {
  subjectName: string
  /** La libreta cerró el período. Sin cierre no se imprime nada de la materia: queda pendiente. */
  closed: boolean
  /** C: conducta en la asignatura. */
  conductValueHundredths: number | null
  /** R: rendimiento, la nota oficial. */
  valueHundredths: number | null
  /** Informe de actuación que el docente escribe al cerrar. */
  conceptualJudgement: string | null
}

/** Las del año hasta `untilYmd` (fin del período que informa); `null`, todo el ciclo. */
export type ReportCardAttendance = AbsenceCounts & { absenceHundredths: number; untilYmd: string | null }

export type ReportCardInput = {
  student: { firstName: string; lastName: string }
  group: { courseName: string; orientationName: string | null; schoolYearLabel: string }
  period: {
    name: string
    /** Encabezado de las columnas C y R: los meses que informa ("Ago-Set"). */
    columnLabel: string
    /** Nombre del texto de cada materia ("Informe de actuación"). */
    judgementLabel: string | null
  }
  subjects: readonly ReportCardSubject[]
  /** Juicio de la reunión de profesores sobre el alumno: el "Informe reunión" de la planilla. */
  meetingJudgement: string | null
  attendance: ReportCardAttendance
}

export type ReportCard = ReportCardInput & {
  /** Faltas enteras del período, redondeadas para abajo (`wholeAbsences`). */
  absenceTotal: number
}

export function buildReportCard(input: ReportCardInput): ReportCard {
  return { ...input, absenceTotal: wholeAbsences(input.attendance.absenceHundredths) }
}

type PeriodGradeRow = {
  studentId: string
  meetingValueHundredths?: number | null
  conductValueHundredths?: number | null
  conceptualJudgement?: string | null
}

/**
 * Lo que va al boletín de una materia. **Sólo lo cerrado**: las notas salen del cierre del docente,
 * y hasta entonces C, R y el informe todavía pueden cambiar. Un período reabierto tampoco cuenta.
 */
export function reportCardSubject(
  subjectName: string,
  state: { status: string; grades: readonly PeriodGradeRow[] } | undefined,
  studentId: string,
): ReportCardSubject {
  const closed = state?.status === 'CLOSED'
  const grade = closed ? state.grades.find((g) => g.studentId === studentId) : undefined
  return {
    subjectName,
    closed,
    conductValueHundredths: grade?.conductValueHundredths ?? null,
    valueHundredths: officialPeriodValue(grade),
    conceptualJudgement: grade?.conceptualJudgement?.trim() || null,
  }
}

type MeetingRecordRow = { studentId: string | null; decision: string; createdAt: Date }

function newest(rows: readonly MeetingRecordRow[]): MeetingRecordRow | null {
  return rows.reduce<MeetingRecordRow | null>((best, row) => (!best || row.createdAt > best.createdAt ? row : best), null)
}

/**
 * Juicio de reunión vigente: la decisión más reciente sobre el alumno o, si no tiene una propia, la
 * del grupo. Es lo mismo que el docente ve como "Juicio Reu." en su cierre.
 */
export function currentMeetingJudgement(records: readonly MeetingRecordRow[], studentId: string): string | null {
  const pick =
    newest(records.filter((row) => row.studentId === studentId)) ?? newest(records.filter((row) => row.studentId == null))
  return pick?.decision.trim() || null
}

/** Días civiles YYYY-MM-DD, ambos inclusive. */
export type YmdRange = { fromYmd: string; toYmd: string }

type WindowPeriod = { id: string; kind: string; sortOrder: number; startsOn: Date | null; endsOn: Date | null }

const ymd = (date: Date) => date.toISOString().slice(0, 10)

function spanOf(periods: readonly WindowPeriod[]): YmdRange | null {
  if (periods.length === 0 || periods.some((p) => !p.startsOn || !p.endsOn)) return null
  const from = periods.map((p) => ymd(p.startsOn!)).sort((a, b) => a.localeCompare(b))[0]
  const to = periods.map((p) => ymd(p.endsOn!)).sort((a, b) => b.localeCompare(a))[0]
  return { fromYmd: from, toYmd: to }
}

/**
 * Días que informa el boletín: los de los tramos que cubre la reunión (una entrega de EBI, los
 * suyos; un semestre de EMS, él mismo). Dan el encabezado de C y R, y su último día corta el
 * acumulado de inasistencias. Sin fechas cargadas, las del propio período; sin ésas, `null`.
 */
export function reportCardWindow(target: WindowPeriod, periods: readonly WindowPeriod[]): YmdRange | null {
  const ids = new Set(assessmentPeriodsFor(target, periods))
  return spanOf(periods.filter((p) => ids.has(p.id))) ?? spanOf([target])
}

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']

/** "Ago-Set": los meses que informa, como lo escribe la planilla. Sin fechas, el nombre del período. */
export function reportCardColumnLabel(range: YmdRange | null, fallback: string): string {
  if (!range) return fallback
  const from = MONTHS[Number(range.fromYmd.slice(5, 7)) - 1]
  const to = MONTHS[Number(range.toYmd.slice(5, 7)) - 1]
  return from === to ? from : `${from}-${to}`
}
