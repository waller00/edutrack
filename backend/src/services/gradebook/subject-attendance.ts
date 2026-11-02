import type { AcademicLevel } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import type { GradeBookScope } from './absences-day.js'
import { reportCardWindow, type YmdRange } from './report-card.js'

/**
 * Inasistencias de cada alumno **en esta asignatura**, para que el docente lleve su control en la
 * carta: cuántas clases faltó sin justificar, cuántas justificadas y cuántas llegó tarde.
 *
 * No son las faltas oficiales. Ésas son del liceo, no de cada materia, y se cuentan por día
 * (`loadAbsenceTotals`). Acá cada clase de la libreta con lista pasada cuenta una vez, y las clases
 * son las del mismo ciclo, grupo, orientación y asignatura que guardó la lista: las de la libreta.
 */
export type MarkCounts = {
  absent: number
  justified: number
  late: number
  /** Clases con lista pasada en las que figura el alumno. */
  classes: number
}

export type SubjectAttendance = {
  studentId: string
  /** Todo el ciclo. */
  total: MarkCounts
  /** Por período (id del período académico): los días que informa cada uno, como el boletín. */
  periods: Record<string, MarkCounts>
}

type Mark = { studentId: string; status: string; ymd: string }
type WindowPeriod = Parameters<typeof reportCardWindow>[0]

function emptyCounts(): MarkCounts {
  return { absent: 0, justified: 0, late: 0, classes: 0 }
}

function addMark(counts: MarkCounts, status: string): void {
  counts.classes += 1
  if (status === 'ABSENT') counts.absent += 1
  else if (status === 'ABSENT_JUSTIFIED') counts.justified += 1
  else if (status === 'LATE') counts.late += 1
}

/**
 * Suma las marcas de cada alumno, en total y por período. Una entrega cuenta los días de los tramos
 * que informa y un tramo o un diagnóstico, los suyos (`reportCardWindow`); un período sin fechas
 * no lleva conteo.
 */
export function tallySubjectAttendance(
  marks: readonly Mark[],
  studentIds: readonly string[],
  periods: readonly WindowPeriod[],
): SubjectAttendance[] {
  const windows: Array<{ id: string; range: YmdRange }> = []
  for (const period of periods) {
    const range = reportCardWindow(period, periods)
    if (range) windows.push({ id: period.id, range })
  }
  const rows = new Map<string, SubjectAttendance>(
    studentIds.map((studentId) => [studentId, { studentId, total: emptyCounts(), periods: {} }]),
  )
  for (const mark of marks) {
    const row = rows.get(mark.studentId)
    if (!row) continue
    addMark(row.total, mark.status)
    for (const { id, range } of windows) {
      if (mark.ymd < range.fromYmd || mark.ymd > range.toYmd) continue
      const counts = row.periods[id] ?? emptyCounts()
      addMark(counts, mark.status)
      row.periods[id] = counts
    }
  }
  return [...rows.values()]
}

/** Las marcas de los alumnos en las clases de la libreta, y los períodos de su nivel. */
export async function loadSubjectAttendance(
  scope: GradeBookScope,
  level: string | null,
  studentIds: readonly string[],
): Promise<SubjectAttendance[]> {
  if (studentIds.length === 0) return []
  const [entries, periods] = await Promise.all([
    prisma.studentAttendanceEntry.findMany({
      where: {
        studentId: { in: [...studentIds] },
        session: {
          schoolYearId: scope.schoolYearId,
          courseOfferingId: scope.courseOfferingId,
          subjectId: scope.subjectId,
          orientationId: scope.orientationId,
          courseOrientationId: scope.courseOrientationId,
        },
      },
      select: { studentId: true, status: true, session: { select: { occurrenceYmd: true } } },
    }),
    prisma.academicPeriod.findMany({
      where: { schoolYearId: scope.schoolYearId, isActive: true, ...(level ? { level: level as AcademicLevel } : {}) },
      select: { id: true, kind: true, sortOrder: true, startsOn: true, endsOn: true },
    }),
  ])
  return tallySubjectAttendance(
    entries.map((entry) => ({ studentId: entry.studentId, status: entry.status, ymd: entry.session.occurrenceYmd })),
    studentIds,
    periods,
  )
}
