import type { SchoolYearApiRow } from '@/contexts/AdminSchoolYearContext'

export type StartPlanOrientation = {
  orientationId: string
  name: string
  code: string | null
  sortOrder: number
  targetOffered: boolean
  sourceOffered: boolean
  recommended: boolean
}

export type StartPlanCourse = {
  id: string
  name: string
  code: string | null
  level: string | null
  sortOrder: number
  targetOffered: boolean
  sourceOffered: boolean
  recommended: boolean
  orientations: StartPlanOrientation[]
}

export type StartPlanStudent = {
  studentId: string
  firstName: string
  lastName: string
  documentId: string | null
  sourceCourseId: string | null
  sourceCourseName: string
  sourceCourseCode: string | null
  sourceOrientationId: string | null
  sourceOrientationName: string | null
  sourceOrientationCode: string | null
  enrollmentStatus: string
}

export type StartPlanPayload = {
  target: SchoolYearApiRow
  source: SchoolYearApiRow | null
  sourceYears: SchoolYearApiRow[]
  courses: StartPlanCourse[]
  students: StartPlanStudent[]
}

export type StartAction = 'PROMOTE' | 'REPEAT' | 'GRADUATED' | 'WITHDRAWN' | 'TRANSFERRED'
export type StartDecision = { action: StartAction; targetCourseId?: string; targetOrientationId?: string; notes?: string }

export type TargetOption = { value: string; label: string; courseId: string; orientationId?: string }

export const START_ACTION_LABEL: Record<StartAction, string> = {
  PROMOTE: 'Pasa',
  REPEAT: 'Repite',
  GRADUATED: 'Egresa',
  WITHDRAWN: 'No siguió',
  TRANSFERRED: 'Transferido',
}

export const ACTIONS_WITH_TARGET = new Set<StartAction>(['PROMOTE', 'REPEAT'])

export function courseLabel(course: Pick<StartPlanCourse, 'name' | 'code'>): string {
  return course.code ? `${course.code} · ${course.name}` : course.name
}

export function orientationKey(courseId: string, orientationId: string): string {
  return `${courseId}:${orientationId}`
}

export function targetValue(courseId?: string, orientationId?: string): string {
  if (!courseId) return ''
  return orientationId ? `${courseId}:${orientationId}` : courseId
}

export function parseTargetValue(value: string): Partial<StartDecision> {
  if (!value) return {}
  const [targetCourseId, targetOrientationId] = value.split(':')
  return { targetCourseId, targetOrientationId }
}

export function sourceGroupKey(student: Pick<StartPlanStudent, 'sourceCourseId' | 'sourceOrientationId'>): string {
  return `${student.sourceCourseId ?? 'none'}:${student.sourceOrientationId ?? ''}`
}

export function buildTargetOptionsForPlan(
  plan: StartPlanPayload,
  courseIds: Set<string>,
  orientationKeys: Set<string>,
): TargetOption[] {
  const options: TargetOption[] = []
  for (const course of plan.courses.filter((row) => courseIds.has(row.id))) {
    const selectedOrientations = course.orientations.filter((orientation) =>
      orientationKeys.has(orientationKey(course.id, orientation.orientationId)),
    )
    if (selectedOrientations.length === 0) {
      options.push({ value: targetValue(course.id), label: courseLabel(course), courseId: course.id })
    } else {
      for (const orientation of selectedOrientations) {
        options.push({
          value: targetValue(course.id, orientation.orientationId),
          label: `${courseLabel(course)} - ${orientation.name}`,
          courseId: course.id,
          orientationId: orientation.orientationId,
        })
      }
    }
  }
  return options
}

function academicCourseRank(course: Pick<StartPlanCourse, 'code' | 'name' | 'level'>): number | null {
  const text = `${course.code ?? ''} ${course.name}`.toUpperCase()
  const level = course.level?.toUpperCase()
  if (level === 'EBI' || text.includes('EBI')) {
    const grade = text.match(/(?:^|\D)([789])(?:\D|$)/)?.[1]
    return grade ? Number(grade) : null
  }
  if (level === 'EMS' || text.includes('EMS')) {
    const grade = text.match(/(?:^|\D)([123])(?:\D|$)/)?.[1]
    return grade ? 100 + Number(grade) : null
  }
  return null
}

/**
 * Sugiere el destino al cambiar la situación académica. Es solo un valor inicial:
 * el selector de curso permanece editable en el asistente.
 */
export function suggestTargetForAction(
  student: Pick<StartPlanStudent, 'sourceCourseId' | 'sourceOrientationId'>,
  action: StartAction,
  plan: Pick<StartPlanPayload, 'courses'>,
  options: TargetOption[],
): Partial<StartDecision> {
  if (!ACTIONS_WITH_TARGET.has(action) || !student.sourceCourseId) return {}

  let courseId: string | undefined
  if (action === 'REPEAT') {
    courseId = student.sourceCourseId
  } else {
    const orderedCourses = [...plan.courses].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    )
    const sourceCourse = orderedCourses.find((course) => course.id === student.sourceCourseId)
    const sourceRank = sourceCourse ? academicCourseRank(sourceCourse) : null
    if (sourceRank != null) {
      // Se elige primero el nivel académico inmediato, aunque no esté ofertado. Así 7.º nunca salta a 9.º.
      courseId = orderedCourses
        .map((course) => ({ course, rank: academicCourseRank(course) }))
        .filter((entry): entry is { course: StartPlanCourse; rank: number } => entry.rank != null && entry.rank > sourceRank)
        .sort((a, b) => a.rank - b.rank)[0]?.course.id
    } else {
      const sourceIndex = orderedCourses.findIndex((course) => course.id === student.sourceCourseId)
      courseId = orderedCourses.slice(sourceIndex >= 0 ? sourceIndex + 1 : 0)[0]?.id
    }
  }

  if (!courseId) return {}
  const sameOrientation = options.find(
    (option) => option.courseId === courseId && option.orientationId === (student.sourceOrientationId ?? undefined),
  )
  const target = sameOrientation ?? options.find((option) => option.courseId === courseId)
  if (!target) return {}
  return {
    targetCourseId: target.courseId,
    ...(target.orientationId ? { targetOrientationId: target.orientationId } : {}),
  }
}

/** Filtra por grupo de curso de origen y por búsqueda libre (nombre/apellido/documento). */
export function filterStartStudents(
  students: StartPlanStudent[],
  groupKey: string,
  query: string,
): StartPlanStudent[] {
  const q = query.trim().toLowerCase()
  return students.filter((student) => {
    if (groupKey && sourceGroupKey(student) !== groupKey) return false
    if (!q) return true
    const haystack = `${student.lastName} ${student.firstName} ${student.documentId ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })
}

/** ¿La decisión del estudiante tiene un destino válido? (las acciones terminales no requieren destino). */
export function studentHasValidTarget(decision: StartDecision | undefined, options: TargetOption[]): boolean {
  const action = decision?.action ?? 'PROMOTE'
  if (!ACTIONS_WITH_TARGET.has(action)) return true
  const value = targetValue(decision?.targetCourseId, decision?.targetOrientationId)
  return options.some((option) => option.value === value)
}

/** Cantidad de estudiantes que pasan/repiten sin un curso destino válido. */
export function countStudentsWithoutTarget(
  students: StartPlanStudent[],
  decisions: Record<string, StartDecision>,
  options: TargetOption[],
): number {
  return students.filter((student) => !studentHasValidTarget(decisions[student.studentId], options)).length
}

export type DestinationCount = { value: string; label: string; count: number }

/** Cuántos estudiantes quedan en cada clase destino (control de cupos antes de confirmar). */
export function summarizeDestinationCounts(
  students: StartPlanStudent[],
  decisions: Record<string, StartDecision>,
  options: TargetOption[],
): DestinationCount[] {
  const labelByValue = new Map(options.map((option) => [option.value, option.label]))
  const counts = new Map<string, number>()
  for (const student of students) {
    const decision = decisions[student.studentId]
    if (!decision || !ACTIONS_WITH_TARGET.has(decision.action)) continue
    const value = targetValue(decision.targetCourseId, decision.targetOrientationId)
    if (!labelByValue.has(value)) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, label: labelByValue.get(value) ?? value }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export type ClosureEntry = { studentId: string; name: string; action: StartAction; actionLabel: string }

/** Estudiantes con acción terminal (egresa / no siguió / transferido), para el resumen de cierres. */
export function summarizeClosures(
  students: StartPlanStudent[],
  decisions: Record<string, StartDecision>,
): ClosureEntry[] {
  const entries: ClosureEntry[] = []
  for (const student of students) {
    const decision = decisions[student.studentId]
    if (!decision || ACTIONS_WITH_TARGET.has(decision.action)) continue
    entries.push({
      studentId: student.studentId,
      name: `${student.lastName}, ${student.firstName}`,
      action: decision.action,
      actionLabel: START_ACTION_LABEL[decision.action],
    })
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}
