import { prisma } from '../../db/prisma.js'
import { absenceHundredthsFor, type DatedWeighableEntry } from './absence-weight.js'

export type AbsenceTotals = {
  /** Total en centésimos: 150 = una falta y media. */
  absenceHundredths: number
  justified: number
  lates: number
}

export const EMPTY_ABSENCE_TOTALS: AbsenceTotals = { absenceHundredths: 0, justified: 0, lates: 0 }

type Mark = { studentId: string; status: string; absenceWeightHundredths: number | null; ymd: string }

/** Agrupa marcas por estudiante y las pesa según el nivel del grupo. */
export function summarizeAbsences(
  marks: readonly Mark[],
  level: string | null | undefined,
): Map<string, AbsenceTotals> {
  const byStudent = new Map<string, DatedWeighableEntry[]>()
  for (const mark of marks) {
    const list = byStudent.get(mark.studentId)
    if (list) list.push(mark)
    else byStudent.set(mark.studentId, [mark])
  }
  const totals = new Map<string, AbsenceTotals>()
  for (const [studentId, entries] of byStudent) {
    totals.set(studentId, {
      absenceHundredths: absenceHundredthsFor(entries, level),
      justified: entries.filter((e) => e.status === 'ABSENT_JUSTIFIED').length,
      lates: entries.filter((e) => e.status === 'LATE').length,
    })
  }
  return totals
}

/**
 * Inasistencias del ciclo, **globales**: el liceo cuenta las faltas del estudiante en el liceo,
 * no las de cada materia. `level` es el del grupo: en ciclo básico (EBI) se cuenta por día.
 */
export async function loadAbsenceTotals(
  studentIds: readonly string[],
  schoolYearId: string,
  level: string | null | undefined,
): Promise<Map<string, AbsenceTotals>> {
  if (studentIds.length === 0) return new Map()
  const rows = await prisma.studentAttendanceEntry.findMany({
    where: { studentId: { in: [...studentIds] }, session: { schoolYearId } },
    select: {
      studentId: true,
      status: true,
      absenceWeightHundredths: true,
      session: { select: { occurrenceYmd: true } },
    },
  })
  return summarizeAbsences(
    rows.map((row) => ({
      studentId: row.studentId,
      status: row.status,
      absenceWeightHundredths: row.absenceWeightHundredths,
      ymd: row.session.occurrenceYmd,
    })),
    level,
  )
}
