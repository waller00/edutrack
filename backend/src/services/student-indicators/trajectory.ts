/**
 * Trayectoria de los estudiantes, derivada al leer: cómo terminó cada año, cuántos promueven,
 * repiten, egresan o dejan el liceo, y qué pasó con cada generación.
 *
 * El fallo no siempre está cargado (`academicResult`): el asistente de inicio de año pasa a los
 * alumnos de grado sin escribirlo. Por eso, cuando falta, se deduce de la matrícula del año
 * siguiente: mismo grado es que repitió, el siguiente es que promovió. Un egreso es promover en el
 * último grado del nivel (o la matrícula marcada como egresada). Si no hay fallo ni matrícula
 * siguiente en el último grado, no se puede saber si egresó o se fue: queda "sin fallo cargado".
 */

export type TrajectoryYear = { id: string; code: number; label: string; status: string; endsOn: Date | null }
export type TrajectoryCourse = { id: string; code: string; name: string; level: string | null; sortOrder: number }
export type TrajectoryEnrollment = {
  studentId: string
  schoolYearId: string
  courseId: string
  enrollmentStatus: string
  academicResult: string | null
  withdrawnAt: Date | null
  withdrawalAcademicYear: number | null
}
/** Materia que el alumno perdió en el año (con lo que pasó en las APE). */
export type FailedSubject = { studentId: string; schoolYearId: string; apeDecember: string | null; apeFebruary: string | null }

export type CourseRank = { level: string | null; position: number; isFinal: boolean; levelLength: number }

/** Grado de cada curso dentro de su nivel, por orden (1 = primer grado). */
export function rankCourses(courses: readonly TrajectoryCourse[]): Map<string, CourseRank> {
  const byLevel = new Map<string | null, TrajectoryCourse[]>()
  for (const course of courses) byLevel.set(course.level, [...(byLevel.get(course.level) ?? []), course])
  const ranks = new Map<string, CourseRank>()
  for (const [level, list] of byLevel) {
    const sorted = [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    sorted.forEach((course, index) => {
      ranks.set(course.id, { level, position: index + 1, isFinal: index === sorted.length - 1, levelLength: sorted.length })
    })
  }
  return ranks
}

export type Departure = 'DURING_YEAR' | 'AT_YEAR_START'

/**
 * Una baja durante el año (dejó de venir, pase a otro centro) o al empezar el siguiente: el
 * asistente de inicio de año da de baja con el año nuevo, y esa matrícula terminó el año.
 */
export function departureOf(enrollment: TrajectoryEnrollment, year: TrajectoryYear): Departure | null {
  if (enrollment.enrollmentStatus !== 'WITHDRAWN' && enrollment.enrollmentStatus !== 'TRANSFERRED') return null
  if (enrollment.withdrawalAcademicYear != null) return enrollment.withdrawalAcademicYear > year.code ? 'AT_YEAR_START' : 'DURING_YEAR'
  if (enrollment.withdrawnAt && year.endsOn && enrollment.withdrawnAt.getTime() > year.endsOn.getTime()) return 'AT_YEAR_START'
  return 'DURING_YEAR'
}

export type YearResult = 'PROMOTED' | 'PROMOTED_WITH_PENDING' | 'REPEATED' | 'PENDING_APE' | null

/** El fallo del año: el cargado, o el que se deduce de la matrícula siguiente. */
export function yearResult(
  enrollment: TrajectoryEnrollment,
  next: TrajectoryEnrollment | null,
  ranks: ReadonlyMap<string, CourseRank>,
  owesAfterApe: boolean,
): YearResult {
  const loaded = enrollment.academicResult
  if (loaded === 'PROMOTED' || loaded === 'PROMOTED_WITH_PENDING' || loaded === 'REPEATED') return loaded
  if (next) {
    const now = ranks.get(enrollment.courseId)
    const then = ranks.get(next.courseId)
    if (now && then && now.level === then.level && then.position <= now.position) return 'REPEATED'
    return owesAfterApe ? 'PROMOTED_WITH_PENDING' : 'PROMOTED'
  }
  if (enrollment.enrollmentStatus === 'GRADUATED') return owesAfterApe ? 'PROMOTED_WITH_PENDING' : 'PROMOTED'
  return loaded === 'PENDING_APE' ? 'PENDING_APE' : null
}

export type Counts = {
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
  /** Terminaron el año pero no siguieron en el liceo (no egresaron). */
  notReenrolled: number
  /** El año siguiente todavía no empezó: no se sabe si siguen. */
  continuationPending: number
}

export const emptyCounts = (): Counts => ({
  enrolled: 0,
  leftWithdrawn: 0,
  leftTransferred: 0,
  inProgress: 0,
  promoted: 0,
  promotedWithPending: 0,
  repeated: 0,
  graduated: 0,
  graduatedWithPending: 0,
  pendingApe: 0,
  noResult: 0,
  notReenrolled: 0,
  continuationPending: 0,
})

export function addCounts(target: Counts, source: Counts): void {
  for (const key of Object.keys(target) as (keyof Counts)[]) target[key] += source[key]
}

export type EnrollmentOutcome = {
  end: 'LEFT_WITHDRAWN' | 'LEFT_TRANSFERRED' | 'IN_PROGRESS' | 'GRADUATED' | 'GRADUATED_WITH_PENDING' | 'PROMOTED' | 'PROMOTED_WITH_PENDING' | 'REPEATED' | 'PENDING_APE' | 'NO_RESULT'
  continuation: 'CONTINUED' | 'NOT_REENROLLED' | 'PENDING' | null
}

const END_KEY: Record<EnrollmentOutcome['end'], keyof Counts> = {
  LEFT_WITHDRAWN: 'leftWithdrawn',
  LEFT_TRANSFERRED: 'leftTransferred',
  IN_PROGRESS: 'inProgress',
  GRADUATED: 'graduated',
  GRADUATED_WITH_PENDING: 'graduatedWithPending',
  PROMOTED: 'promoted',
  PROMOTED_WITH_PENDING: 'promotedWithPending',
  REPEATED: 'repeated',
  PENDING_APE: 'pendingApe',
  NO_RESULT: 'noResult',
}

export type OutcomeContext = {
  year: TrajectoryYear
  next: TrajectoryEnrollment | null
  /** El año siguiente ya tiene matrículas: quien no está ahí, no siguió. */
  nextYearStarted: boolean
  ranks: ReadonlyMap<string, CourseRank>
  owesAfterApe: boolean
}

function endOf(result: YearResult, isFinal: boolean, hasNext: boolean): EnrollmentOutcome['end'] {
  const promoted = result === 'PROMOTED' || result === 'PROMOTED_WITH_PENDING'
  if (promoted && isFinal && !hasNext) return result === 'PROMOTED' ? 'GRADUATED' : 'GRADUATED_WITH_PENDING'
  if (result === null) return 'NO_RESULT'
  return result
}

/** Cómo terminó una matrícula el año, y si siguió el año siguiente. */
export function outcomeOf(enrollment: TrajectoryEnrollment, ctx: OutcomeContext): EnrollmentOutcome {
  const departure = departureOf(enrollment, ctx.year)
  if (departure === 'DURING_YEAR') {
    return { end: enrollment.enrollmentStatus === 'TRANSFERRED' ? 'LEFT_TRANSFERRED' : 'LEFT_WITHDRAWN', continuation: null }
  }
  if (ctx.year.status !== 'CLOSED') return { end: 'IN_PROGRESS', continuation: null }
  const result = yearResult(enrollment, ctx.next, ctx.ranks, ctx.owesAfterApe)
  const isFinal = ctx.ranks.get(enrollment.courseId)?.isFinal ?? false
  const end = endOf(result, isFinal, ctx.next !== null)
  if (end === 'GRADUATED' || end === 'GRADUATED_WITH_PENDING') return { end, continuation: null }
  // En el último grado, sin fallo ni matrícula siguiente no se sabe si egresó o se fue: no cuenta para ninguna.
  if (end === 'NO_RESULT' && isFinal && !ctx.next) return { end, continuation: null }
  if (ctx.next) return { end, continuation: 'CONTINUED' }
  if (departure === 'AT_YEAR_START' || ctx.nextYearStarted) return { end, continuation: 'NOT_REENROLLED' }
  return { end, continuation: 'PENDING' }
}

export function countOutcome(counts: Counts, outcome: EnrollmentOutcome): void {
  counts.enrolled++
  counts[END_KEY[outcome.end]]++
  if (outcome.continuation === 'NOT_REENROLLED') counts.notReenrolled++
  if (outcome.continuation === 'PENDING') counts.continuationPending++
}

/** El año que se mira: el pedido si ya cerró; si no, el último cerrado. */
export function focusYear(years: readonly TrajectoryYear[], requestedId: string | null): TrajectoryYear | null {
  const requested = years.find((year) => year.id === requestedId)
  if (requested?.status === 'CLOSED') return requested
  const closed = years.filter((year) => year.status === 'CLOSED' && (!requested || year.code < requested.code))
  return closed.sort((a, b) => b.code - a.code)[0] ?? null
}

// ─── Generaciones ───────────────────────────────────────────────────────────

export type CohortStatus = 'GRADUATED_ON_TIME' | 'GRADUATED_LATE' | 'ON_TRACK' | 'BEHIND' | 'LEFT' | 'UNKNOWN'

export type CohortTimelinePoint = { code: number; onTrack: number; behind: number; left: number; graduated: number; unknown: number }

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
  timeline: CohortTimelinePoint[]
}

/** Lo que importa de cada matrícula de un alumno para seguir su generación. */
export type StudentStep = { code: number; position: number; outcome: EnrollmentOutcome }

/** Año en que egresó o dejó el liceo (dejar sin reinscribirse cuenta desde el año siguiente). */
function milestones(steps: readonly StudentStep[]): { graduatedIn: number | null; leftIn: number | null } {
  let graduatedIn: number | null = null
  let leftIn: number | null = null
  for (const step of steps) {
    const { end, continuation } = step.outcome
    if (end === 'GRADUATED' || end === 'GRADUATED_WITH_PENDING') graduatedIn = step.code
    if (end === 'LEFT_WITHDRAWN' || end === 'LEFT_TRANSFERRED') leftIn = leftIn ?? step.code
    if (continuation === 'NOT_REENROLLED') leftIn = leftIn ?? step.code + 1
  }
  return { graduatedIn, leftIn }
}

/** Dónde estaba un alumno de la generación al terminar el año `code`. */
export function statusAt(steps: readonly StudentStep[], entryYear: number, levelLength: number, code: number): CohortStatus {
  const { graduatedIn, leftIn } = milestones(steps)
  if (graduatedIn !== null && graduatedIn <= code) return graduatedIn === entryYear + levelLength - 1 ? 'GRADUATED_ON_TIME' : 'GRADUATED_LATE'
  if (leftIn !== null && leftIn <= code) return 'LEFT'
  const step = steps.find((s) => s.code === code)
  if (!step) return 'UNKNOWN'
  return step.position >= 1 + (code - entryYear) ? 'ON_TRACK' : 'BEHIND'
}

type CohortCountKey = 'graduatedOnTime' | 'graduatedLate' | 'onTrack' | 'behind' | 'left' | 'unknown'

const COHORT_KEY: Record<CohortStatus, CohortCountKey> = {
  GRADUATED_ON_TIME: 'graduatedOnTime',
  GRADUATED_LATE: 'graduatedLate',
  ON_TRACK: 'onTrack',
  BEHIND: 'behind',
  LEFT: 'left',
  UNKNOWN: 'unknown',
}

const POINT_KEY: Record<CohortStatus, keyof Omit<CohortTimelinePoint, 'code'>> = {
  GRADUATED_ON_TIME: 'graduated',
  GRADUATED_LATE: 'graduated',
  ON_TRACK: 'onTrack',
  BEHIND: 'behind',
  LEFT: 'left',
  UNKNOWN: 'unknown',
}

function timelinePoint(code: number, statuses: readonly CohortStatus[]): CohortTimelinePoint {
  const point: CohortTimelinePoint = { code, onTrack: 0, behind: 0, left: 0, graduated: 0, unknown: 0 }
  for (const status of statuses) point[POINT_KEY[status]]++
  return point
}

type StudentTrack = { level: string | null; levelLength: number; steps: StudentStep[] }

function summarizeCohort(level: string | null, entryYear: number, levelLength: number, members: readonly StudentStep[][], lastCode: number): Cohort {
  const cohort: Cohort = { level, entryYear, entrants: members.length, graduatedOnTime: 0, graduatedLate: 0, onTrack: 0, behind: 0, left: 0, unknown: 0, timeline: [] }
  for (const steps of members) cohort[COHORT_KEY[statusAt(steps, entryYear, levelLength, lastCode)]]++
  for (let code = entryYear; code <= lastCode; code++) {
    cohort.timeline.push(timelinePoint(code, members.map((steps) => statusAt(steps, entryYear, levelLength, code))))
  }
  return cohort
}

/**
 * Generaciones: quienes entran al primer grado de un nivel un año, seguidos hasta el último año con
 * datos. Los que entran por pase a otro grado no forman generación.
 */
export function buildCohorts(tracksByStudent: ReadonlyMap<string, readonly StudentTrack[]>, lastCode: number): Cohort[] {
  const groups = new Map<string, { level: string | null; entryYear: number; levelLength: number; members: StudentStep[][] }>()
  for (const tracks of tracksByStudent.values()) {
    for (const track of tracks) {
      const first = track.steps[0]
      if (first?.position !== 1) continue
      const key = `${track.level}|${first.code}`
      const group = groups.get(key) ?? { level: track.level, entryYear: first.code, levelLength: track.levelLength, members: [] }
      group.members.push(track.steps)
      groups.set(key, group)
    }
  }
  return [...groups.values()]
    .map((group) => summarizeCohort(group.level, group.entryYear, group.levelLength, group.members, lastCode))
    .sort((a, b) => String(a.level).localeCompare(String(b.level)) || a.entryYear - b.entryYear)
}

// ─── Todo junto ─────────────────────────────────────────────────────────────

export type YearRef = { id: string; code: number; label: string; status: string }
export type CourseRef = { courseId: string; courseName: string; level: string | null; position: number }

export type Trajectory = {
  requestedYear: YearRef | null
  focusYear: YearRef | null
  byCourse: (CourseRef & Counts)[]
  total: Counts
  byYear: (YearRef & Counts)[]
  cohorts: Cohort[]
}

export type TrajectoryInput = {
  years: readonly TrajectoryYear[]
  courses: readonly TrajectoryCourse[]
  enrollments: readonly TrajectoryEnrollment[]
  failed: readonly FailedSubject[]
}

const yearRef = (year: TrajectoryYear): YearRef => ({ id: year.id, code: year.code, label: year.label, status: year.status })

/** Matrículas de cada alumno por año, qué quedó debiendo después de las APE y qué años tienen datos. */
function indexInput(input: TrajectoryInput) {
  const codeOf = new Map(input.years.map((year) => [year.id, year.code]))
  const byStudentYear = new Map<string, TrajectoryEnrollment>()
  for (const enrollment of input.enrollments) byStudentYear.set(`${enrollment.studentId}|${codeOf.get(enrollment.schoolYearId)}`, enrollment)
  const owes = new Set(
    input.failed
      .filter((row) => row.apeDecember !== 'PASSED' && row.apeFebruary !== 'PASSED')
      .map((row) => `${row.studentId}|${row.schoolYearId}`),
  )
  const codesWithData = new Set<number>()
  for (const enrollment of input.enrollments) {
    const code = codeOf.get(enrollment.schoolYearId)
    if (code !== undefined) codesWithData.add(code)
  }
  return { byStudentYear, owes, codesWithData }
}

function addStep(tracks: Map<string, Map<string | null, StudentTrack>>, studentId: string, rank: CourseRank, step: StudentStep) {
  const studentTracks = tracks.get(studentId) ?? new Map<string | null, StudentTrack>()
  const track = studentTracks.get(rank.level) ?? { level: rank.level, levelLength: rank.levelLength, steps: [] }
  track.steps.push(step)
  studentTracks.set(rank.level, track)
  tracks.set(studentId, studentTracks)
}

function sortedTracks(tracks: ReadonlyMap<string, Map<string | null, StudentTrack>>): Map<string, StudentTrack[]> {
  return new Map(
    [...tracks].map(([studentId, byLevel]) => [
      studentId,
      [...byLevel.values()].map((track) => ({ ...track, steps: [...track.steps].sort((a, b) => a.code - b.code) })),
    ]),
  )
}

export function buildTrajectory(input: TrajectoryInput, requestedYearId: string | null): Trajectory {
  const years = [...input.years].sort((a, b) => a.code - b.code)
  const yearById = new Map(years.map((year) => [year.id, year]))
  const ranks = rankCourses(input.courses)
  const courseById = new Map(input.courses.map((course) => [course.id, course]))
  const { byStudentYear, owes, codesWithData } = indexInput(input)
  const focus = focusYear(years, requestedYearId)

  const byYear = new Map<string, Counts>(years.map((year) => [year.id, emptyCounts()]))
  const byCourse = new Map<string, Counts>()
  const tracks = new Map<string, Map<string | null, StudentTrack>>()
  for (const enrollment of input.enrollments) {
    const year = yearById.get(enrollment.schoolYearId)
    const rank = ranks.get(enrollment.courseId)
    if (!year || !rank) continue
    const outcome = outcomeOf(enrollment, {
      year,
      next: byStudentYear.get(`${enrollment.studentId}|${year.code + 1}`) ?? null,
      nextYearStarted: codesWithData.has(year.code + 1),
      ranks,
      owesAfterApe: owes.has(`${enrollment.studentId}|${enrollment.schoolYearId}`),
    })
    countOutcome(byYear.get(year.id)!, outcome)
    if (focus?.id === year.id) {
      const counts = byCourse.get(enrollment.courseId) ?? emptyCounts()
      countOutcome(counts, outcome)
      byCourse.set(enrollment.courseId, counts)
    }
    addStep(tracks, enrollment.studentId, rank, { code: year.code, position: rank.position, outcome })
  }

  const lastCode = Math.max(years.at(-1)?.code ?? 0, ...codesWithData)
  const courseRows = [...byCourse].map(([courseId, counts]) => ({
    courseId,
    courseName: courseById.get(courseId)!.name,
    level: courseById.get(courseId)!.level,
    position: ranks.get(courseId)!.position,
    ...counts,
  }))
  const total = emptyCounts()
  for (const counts of byCourse.values()) addCounts(total, counts)
  const requested = requestedYearId ? yearById.get(requestedYearId) : undefined

  return {
    requestedYear: requested ? yearRef(requested) : null,
    focusYear: focus ? yearRef(focus) : null,
    byCourse: courseRows.sort((a, b) => String(a.level).localeCompare(String(b.level)) || a.position - b.position),
    total,
    byYear: years.filter((year) => codesWithData.has(year.code)).map((year) => ({ ...yearRef(year), ...byYear.get(year.id)! })),
    cohorts: buildCohorts(sortedTracks(tracks), lastCode),
  }
}
