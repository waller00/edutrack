import { NO_DATA_COLOR, SERIES_COLORS, type Part, type YearRef } from './student-indicators'

/**
 * Trayectoria y APE, como las devuelven `/admin/academic-analytics/trajectory` y
 * `/admin/student-reports/subjects-ape`. El fallo de cada año lo deriva el backend al leer (de lo
 * cargado o de la matrícula del año siguiente); acá sólo se arman los números de la pantalla.
 */

export type TrajectoryCounts = {
  enrolled: number
  leftWithdrawn: number
  leftTransferred: number
  inProgress: number
  promoted: number
  promotedWithPending: number
  repeated: number
  graduated: number
  graduatedWithPending: number
  pendingApe: number
  noResult: number
  notReenrolled: number
  continuationPending: number
}

export type TrajectoryCourse = TrajectoryCounts & { courseId: string; courseName: string; level: string | null; position: number }

export type Cohort = {
  level: string | null
  entryYear: number
  entrants: number
  graduatedOnTime: number
  graduatedLate: number
  onTrack: number
  behind: number
  left: number
  unknown: number
}

export type TrajectoryResponse = {
  requestedYear: YearRef | null
  focusYear: YearRef | null
  byCourse: TrajectoryCourse[]
  total: TrajectoryCounts
  byYear: (YearRef & TrajectoryCounts)[]
  cohorts: Cohort[]
}

export type TrajectoryHeadline = {
  enrolled: number
  promoted: number
  promotedWithPending: number
  repeated: number
  graduated: number
  /** Matriculados en el último grado de su nivel: de ellos sale el egreso. */
  finalEnrolled: number
  /** Se fueron en el año (bajas y pases) más los que no se reinscribieron. */
  left: number
  leftDuringYear: number
  notReenrolled: number
}

/** El último grado de cada nivel es el de mayor posición entre los cursos del año. */
function finalGradeEnrolled(byCourse: readonly TrajectoryCourse[]): number {
  const last = new Map<string, number>()
  for (const row of byCourse) last.set(String(row.level), Math.max(last.get(String(row.level)) ?? 0, row.position))
  return byCourse.filter((row) => row.position === last.get(String(row.level))).reduce((acc, row) => acc + row.enrolled, 0)
}

export function trajectoryHeadline(total: TrajectoryCounts, byCourse: readonly TrajectoryCourse[]): TrajectoryHeadline {
  const leftDuringYear = total.leftWithdrawn + total.leftTransferred
  return {
    enrolled: total.enrolled,
    promoted: total.promoted + total.promotedWithPending,
    promotedWithPending: total.promotedWithPending,
    repeated: total.repeated,
    graduated: total.graduated + total.graduatedWithPending,
    finalEnrolled: finalGradeEnrolled(byCourse),
    left: leftDuringYear + total.notReenrolled,
    leftDuringYear,
    notReenrolled: total.notReenrolled,
  }
}

/** Cómo terminó el año cada matrícula; las partes suman los matriculados. */
export function outcomeParts(counts: TrajectoryCounts): Part[] {
  return [
    { key: 'promoted', label: 'Promovieron', value: counts.promoted + counts.promotedWithPending, color: SERIES_COLORS[0] },
    { key: 'repeated', label: 'Repitieron', value: counts.repeated, color: SERIES_COLORS[1] },
    { key: 'graduated', label: 'Egresaron', value: counts.graduated + counts.graduatedWithPending, color: SERIES_COLORS[2] },
    { key: 'left', label: 'Se fueron en el año', value: counts.leftWithdrawn + counts.leftTransferred, color: SERIES_COLORS[3] },
    {
      key: 'other',
      label: 'Sin fallo o cursando',
      value: counts.pendingApe + counts.noResult + counts.inProgress,
      color: NO_DATA_COLOR,
    },
  ]
}

export const LEVEL_NAMES: Record<string, string> = { EBI: 'ciclo básico', EMS: 'bachillerato' }

/** «Ingreso 2023 (ciclo básico)». */
export function cohortLabel(cohort: Pick<Cohort, 'entryYear' | 'level'>): string {
  const level = cohort.level ? LEVEL_NAMES[cohort.level] : undefined
  return level ? `Ingreso ${cohort.entryYear} (${level})` : `Ingreso ${cohort.entryYear}`
}

/** Qué fue de cada generación hasta el último año con datos; las partes suman los que entraron. */
export function cohortParts(cohort: Cohort): Part[] {
  return [
    { key: 'graduatedOnTime', label: 'Egresaron en tiempo', value: cohort.graduatedOnTime, color: SERIES_COLORS[0] },
    { key: 'graduatedLate', label: 'Egresaron con atraso', value: cohort.graduatedLate, color: SERIES_COLORS[1] },
    { key: 'onTrack', label: 'Siguen en tiempo', value: cohort.onTrack, color: SERIES_COLORS[2] },
    { key: 'behind', label: 'Siguen atrasados', value: cohort.behind, color: SERIES_COLORS[3] },
    { key: 'left', label: 'Dejaron el liceo', value: cohort.left, color: SERIES_COLORS[4] },
    { key: 'unknown', label: 'Sin dato', value: cohort.unknown, color: NO_DATA_COLOR },
  ]
}

// ─── Materias y APE ─────────────────────────────────────────────────────────

export type ApeCounts = { referred: number; december: number; february: number; previa: number; owed: number }

export type SubjectsApeResponse = {
  requestedYear: YearRef | null
  focusYear: YearRef | null
  students: { referred: number; clearedByFebruary: number; clearedLater: number; stillOwing: number }
  byCourse: (ApeCounts & { courseId: string; courseName: string; position: number; studentsReferred: number })[]
  rows: (ApeCounts & { courseId: string; courseName: string; position: number; subjectId: string; subjectName: string })[]
  carriedOver: { students: number; subjects: number }
}

/** Qué pasó con cada materia que fue a APE: las partes suman las materias. */
export function apeParts(counts: ApeCounts): Part[] {
  return [
    { key: 'december', label: 'Salvó en diciembre', value: counts.december, color: SERIES_COLORS[0] },
    { key: 'february', label: 'Salvó en febrero', value: counts.february, color: SERIES_COLORS[1] },
    { key: 'previa', label: 'Salvó después, como previa', value: counts.previa, color: SERIES_COLORS[2] },
    { key: 'owed', label: 'Todavía la debe', value: counts.owed, color: SERIES_COLORS[3], alert: counts.owed > 0 },
  ]
}

/** «Ciclo 2026 todavía no terminó: se muestra Ciclo 2025.», cuando el año mirado no es el elegido. */
export function focusNote(requested: YearRef | null, focus: YearRef | null, reason: string): string | null {
  if (!focus || !requested || requested.id === focus.id) return null
  return `${requested.label} ${reason}: se muestra ${focus.label}.`
}
