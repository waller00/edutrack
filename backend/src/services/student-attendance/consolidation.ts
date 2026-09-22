import type { StudentAttendanceStatus } from '@prisma/client'

/**
 * Una marca de un estudiante en una clase, ya aplanada para el cálculo.
 * `subjectId`/`subjectName` pueden ser null (clase sin asignatura asociada).
 */
export type AttendanceCell = {
  ymd: string
  status: StudentAttendanceStatus
  subjectId: string | null
  subjectName: string | null
}

export type DailyConsolidation = 'PRESENT' | 'HALF_ABSENCE' | 'ABSENCE' | 'NO_CLASSES'

export const DAILY_CONSOLIDATION_LABEL: Record<DailyConsolidation, string> = {
  PRESENT: 'Presente',
  HALF_ABSENCE: 'Media falta',
  ABSENCE: 'Falta',
  NO_CLASSES: 'Sin clases',
}

function isAbsent(status: StudentAttendanceStatus): boolean {
  return status === 'ABSENT' || status === 'ABSENT_JUSTIFIED'
}

/**
 * Consolida el día a partir de las clases efectivamente listadas.
 *
 * La unidad guardada es la clase; el día se deriva al leer. Una llegada tarde NO es ausencia:
 * el alumno estuvo. Las clases sin lista tomada no llegan acá (no se inventan faltas), así
 * que nunca deflactan el resultado.
 */
export function consolidateDay(
  cells: readonly AttendanceCell[],
  opts: { thresholdPercent: number },
): DailyConsolidation {
  if (cells.length === 0) return 'NO_CLASSES'
  const absent = cells.filter((c) => isAbsent(c.status)).length
  if (absent === 0) return 'PRESENT'
  const ratio = (absent / cells.length) * 100
  return ratio >= opts.thresholdPercent ? 'ABSENCE' : 'HALF_ABSENCE'
}

export function groupByDay(cells: readonly AttendanceCell[]): Map<string, AttendanceCell[]> {
  const byDay = new Map<string, AttendanceCell[]>()
  for (const cell of cells) {
    const list = byDay.get(cell.ymd)
    if (list) list.push(cell)
    else byDay.set(cell.ymd, [cell])
  }
  return byDay
}

export type DailyRow = {
  ymd: string
  value: DailyConsolidation
  classes: number
  absences: number
  /** Unidades de falta del día: 1 falta entera, 0.5 media falta. */
  absenceUnits: number
}

export function consolidateRange(
  cells: readonly AttendanceCell[],
  opts: { thresholdPercent: number },
): DailyRow[] {
  const rows: DailyRow[] = []
  for (const [ymd, dayCells] of groupByDay(cells)) {
    const value = consolidateDay(dayCells, opts)
    rows.push({
      ymd,
      value,
      classes: dayCells.length,
      absences: dayCells.filter((c) => isAbsent(c.status)).length,
      absenceUnits: value === 'ABSENCE' ? 1 : value === 'HALF_ABSENCE' ? 0.5 : 0,
    })
  }
  return rows.sort((a, b) => a.ymd.localeCompare(b.ymd))
}

export type SubjectTotals = {
  subjectId: string | null
  subjectName: string
  classes: number
  present: number
  late: number
  absent: number
  absentJustified: number
  attendancePercent: number
}

/** Porcentaje de asistencia. LATE cuenta como asistencia: el alumno estuvo en clase. */
export function attendancePercentOf(cells: readonly AttendanceCell[]): number {
  if (cells.length === 0) return 0
  const attended = cells.filter((c) => c.status === 'PRESENT' || c.status === 'LATE').length
  return Math.round((attended / cells.length) * 1000) / 10
}

export function totalsBySubject(cells: readonly AttendanceCell[]): SubjectTotals[] {
  const bySubject = new Map<string, AttendanceCell[]>()
  for (const cell of cells) {
    const key = cell.subjectId ?? '__none__'
    const list = bySubject.get(key)
    if (list) list.push(cell)
    else bySubject.set(key, [cell])
  }

  const rows: SubjectTotals[] = []
  for (const [, subjectCells] of bySubject) {
    const first = subjectCells[0]
    rows.push({
      subjectId: first.subjectId,
      subjectName: first.subjectName ?? 'Sin asignatura',
      classes: subjectCells.length,
      present: subjectCells.filter((c) => c.status === 'PRESENT').length,
      late: subjectCells.filter((c) => c.status === 'LATE').length,
      absent: subjectCells.filter((c) => c.status === 'ABSENT').length,
      absentJustified: subjectCells.filter((c) => c.status === 'ABSENT_JUSTIFIED').length,
      attendancePercent: attendancePercentOf(subjectCells),
    })
  }
  return rows.sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'es'))
}

export type OverallTotals = {
  classes: number
  present: number
  late: number
  absent: number
  absentJustified: number
  /** Faltas totales (justificadas + no) y solo las no justificadas, que son las que penalizan. */
  absencesTotal: number
  absencesUnjustified: number
  attendancePercent: number
  absenceUnits: number
}

export function overallTotals(
  cells: readonly AttendanceCell[],
  opts: { thresholdPercent: number },
): OverallTotals {
  const absent = cells.filter((c) => c.status === 'ABSENT').length
  const absentJustified = cells.filter((c) => c.status === 'ABSENT_JUSTIFIED').length
  return {
    classes: cells.length,
    present: cells.filter((c) => c.status === 'PRESENT').length,
    late: cells.filter((c) => c.status === 'LATE').length,
    absent,
    absentJustified,
    absencesTotal: absent + absentJustified,
    absencesUnjustified: absent,
    attendancePercent: attendancePercentOf(cells),
    absenceUnits: consolidateRange(cells, opts).reduce((sum, row) => sum + row.absenceUnits, 0),
  }
}
