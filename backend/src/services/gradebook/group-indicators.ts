import { prisma } from '../../db/prisma.js'
import { distributionByLevel, type LevelRow } from './analytics.js'
import type { GradeBookScope } from './absences-day.js'
import { describeValue, isReportCardPeriod, PERIOD_SCALE_CODE_BY_LEVEL } from './period-closure.js'
import { tallySubjectAttendance, type SubjectAttendance } from './subject-attendance.js'

/**
 * El seguimiento de un grupo en la materia de una libreta, para su docente: cómo vienen las faltas
 * a sus clases, cuántos tienen la R en tramo de alerta en el boletín y quiénes bajaron respecto del
 * anterior.
 *
 * Es **sólo esta libreta**: nunca notas de otras materias ni cuántas materias tiene bajas un alumno,
 * ni sus previas. Tampoco los umbrales de 18 y 25 faltas: son del liceo (las faltas oficiales se
 * cuentan por día) y los sigue administración.
 */

export type GroupStudent = { studentId: string; lastName: string; firstName: string }

export type GroupPeriod = {
  id: string
  name: string
  kind: string
  sortOrder: number
  isMeeting: boolean
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
}

export type GroupIndicatorsInput = {
  roster: readonly GroupStudent[]
  attendance: readonly SubjectAttendance[]
  /** Clases de la libreta con la lista pasada. */
  takenClasses: number
  periods: readonly GroupPeriod[]
  /** R de cada alumno en cada reunión de esta libreta. */
  grades: readonly { periodId: string; studentId: string; meetingValueHundredths: number | null }[]
  closedPeriodIds: ReadonlySet<string>
  levels: readonly LevelRow[]
}

type StudentMarks = GroupStudent & { classes: number; absent: number; justified: number; late: number }

function attendanceBlock(input: GroupIndicatorsInput) {
  const byStudent = new Map(input.attendance.map((row) => [row.studentId, row.total]))
  const students: StudentMarks[] = input.roster.map((student) => {
    const total = byStudent.get(student.studentId) ?? { classes: 0, absent: 0, justified: 0, late: 0 }
    return { ...student, ...total }
  })
  const sum = (key: 'classes' | 'absent' | 'justified' | 'late') => students.reduce((acc, s) => acc + s[key], 0)
  return {
    classesWithRollCall: input.takenClasses,
    marks: sum('classes'),
    absent: sum('absent'),
    justified: sum('justified'),
    late: sum('late'),
    // Los que faltan o llegan tarde, primero los que más faltaron sin justificar.
    students: students
      .filter((s) => s.absent + s.justified + s.late > 0)
      .sort((a, b) => b.absent - a.absent || b.justified - a.justified || b.late - a.late || a.lastName.localeCompare(b.lastName, 'es')),
  }
}

/** R de cada alumno del grupo en una reunión. */
function valuesAt(input: GroupIndicatorsInput, periodId: string): Map<string, number> {
  const roster = new Set(input.roster.map((s) => s.studentId))
  return new Map(
    input.grades
      .filter((g) => g.periodId === periodId && g.meetingValueHundredths != null && roster.has(g.studentId))
      .map((g) => [g.studentId, g.meetingValueHundredths as number]),
  )
}

/** Las reuniones de boletín con alguna R, en orden. */
function gradedReportCards(input: GroupIndicatorsInput): GroupPeriod[] {
  return [...input.periods]
    .filter((p) => isReportCardPeriod(p) && valuesAt(input, p.id).size > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

function gradesBlock(input: GroupIndicatorsInput, reference: GroupPeriod | undefined) {
  if (!reference) return { reference: null, graded: 0, alert: 0, distribution: [], students: [] }
  const values = valuesAt(input, reference.id)
  const names = new Map(input.roster.map((s) => [s.studentId, s]))
  const students = [...values]
    .map(([studentId, valueHundredths]) => {
      const level = describeValue(valueHundredths, input.levels as never)
      return { ...names.get(studentId)!, valueHundredths, levelLabel: level?.label ?? null, isAlert: Boolean(level?.isAlert) }
    })
    .filter((s) => s.isAlert)
    .sort((a, b) => a.valueHundredths - b.valueHundredths || a.lastName.localeCompare(b.lastName, 'es'))
  return {
    reference: { periodId: reference.id, name: reference.name, closed: input.closedPeriodIds.has(reference.id) },
    graded: values.size,
    alert: students.length,
    distribution: distributionByLevel([...values.values()], input.levels).map(({ levelId, label, isAlert, count }) => ({ levelId, label, isAlert, count })),
    students,
  }
}

function evolutionBlock(input: GroupIndicatorsInput, from: GroupPeriod | undefined, to: GroupPeriod | undefined) {
  if (!from || !to) return null
  const before = valuesAt(input, from.id)
  const after = valuesAt(input, to.id)
  const names = new Map(input.roster.map((s) => [s.studentId, s]))
  let improved = 0
  let same = 0
  const declined: (GroupStudent & { fromHundredths: number; toHundredths: number })[] = []
  for (const [studentId, toHundredths] of after) {
    const fromHundredths = before.get(studentId)
    if (fromHundredths == null) continue
    if (toHundredths > fromHundredths) improved++
    else if (toHundredths === fromHundredths) same++
    else declined.push({ ...names.get(studentId)!, fromHundredths, toHundredths })
  }
  declined.sort((a, b) => a.toHundredths - a.fromHundredths - (b.toHundredths - b.fromHundredths) || a.lastName.localeCompare(b.lastName, 'es'))
  return {
    from: { periodId: from.id, name: from.name },
    to: { periodId: to.id, name: to.name },
    compared: improved + same + declined.length,
    improved,
    same,
    declined: declined.length,
    students: declined,
  }
}

/** Pura: todo sale de lo cargado en esta libreta. */
export function groupIndicators(input: GroupIndicatorsInput) {
  const reportCards = gradedReportCards(input)
  const reference = reportCards.at(-1)
  return {
    rosterSize: input.roster.length,
    attendance: attendanceBlock(input),
    grades: gradesBlock(input, reference),
    evolution: evolutionBlock(input, reportCards.at(-2), reference),
  }
}

export type GroupIndicators = ReturnType<typeof groupIndicators>

const PERIOD_SELECT = {
  id: true,
  name: true,
  kind: true,
  sortOrder: true,
  startsOn: true,
  endsOn: true,
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
} as const

/**
 * Períodos y escala del nivel, compartidos entre las libretas de un mismo pedido: todas las del
 * docente son del mismo ciclo, y casi siempre del mismo nivel.
 */
export type SharedLookups = Map<string, Promise<unknown>>

function shared<T>(cache: SharedLookups | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!cache) return load()
  if (!cache.has(key)) cache.set(key, load())
  return cache.get(key) as Promise<T>
}

/** Lo que hace falta de una libreta para su seguimiento: sólo de ella, nunca de otra libreta. */
export async function loadGroupIndicators(
  book: { id: string; scope: GradeBookScope; level: string | null; roster: readonly GroupStudent[] },
  cache?: SharedLookups,
) {
  const studentIds = book.roster.map((s) => s.studentId)
  const level = book.level === 'EMS' ? 'EMS' : 'EBI'
  const [entries, sessions, periods, states, scale] = await Promise.all([
    prisma.studentAttendanceEntry.findMany({
      where: { studentId: { in: studentIds }, session: { ...book.scope, status: 'TAKEN' } },
      select: { studentId: true, status: true, session: { select: { occurrenceYmd: true } } },
    }),
    prisma.studentAttendanceSession.count({ where: { ...book.scope, status: 'TAKEN' } }),
    shared(cache, `periods|${book.scope.schoolYearId}|${book.level}`, () =>
      prisma.academicPeriod.findMany({
        where: { schoolYearId: book.scope.schoolYearId, isActive: true, ...(book.level ? { level: book.level as never } : {}) },
        select: PERIOD_SELECT,
      }),
    ),
    prisma.gradeBookPeriod.findMany({
      where: { gradeBookId: book.id },
      select: { periodId: true, status: true, grades: { select: { studentId: true, meetingValueHundredths: true } } },
    }),
    shared(cache, `scale|${level}`, () =>
      prisma.gradingScale.findUnique({
        where: { code: PERIOD_SCALE_CODE_BY_LEVEL[level] },
        include: { levels: { orderBy: { sortOrder: 'asc' } } },
      }),
    ),
  ])
  return groupIndicators({
    roster: book.roster,
    attendance: tallySubjectAttendance(
      entries.map((e) => ({ studentId: e.studentId, status: e.status, ymd: e.session.occurrenceYmd })),
      studentIds,
      periods,
    ),
    takenClasses: sessions,
    periods,
    grades: states.flatMap((state) => state.grades.map((g) => ({ periodId: state.periodId, ...g }))),
    closedPeriodIds: new Set(states.filter((s) => s.status === 'CLOSED').map((s) => s.periodId)),
    levels: scale?.levels ?? [],
  })
}
