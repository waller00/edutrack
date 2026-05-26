export type CourseRow = {
  id: string
  name: string
  code: string | null
  level: 'EBI' | 'EMS' | null
  sortOrder: number
  description: string | null
  isActive: boolean
  schoolYearId?: string | null
  courseOfferingId?: string | null
  offeringIsActive?: boolean | null
  offeringIsOffered?: boolean | null
  visibleInFilters?: boolean | null
  offeringNotes?: string | null
}

export type SubjectRow = {
  id: string
  name: string
  code: string | null
  description: string | null
  sortOrder: number
  isActive: boolean
  courseId: string
  associationType?: string | null
  orientationId?: string | null
  assignmentIsActive?: boolean | null
  assignmentIsOffered?: boolean | null
  visibleInFilters?: boolean | null
}

export type OrientationRow = {
  id: string
  name: string
  code: string | null
  description: string | null
  isActive: boolean
  sortOrder: number
}

export type CourseOrientationRow = {
  id: string
  courseId: string
  orientationId: string
  schoolYearId: string | null
  isActive: boolean
  isOffered?: boolean | null
  visibleInFilters?: boolean | null
  notes: string | null
  orientation: OrientationRow
}

export type CourseDetailTab = 'plan' | 'general' | 'offer'

export type SubjectDraft = {
  name: string
  code: string
  sortOrder: number
  description: string
  isActive: boolean
}

export function emptySubjectDraft(): SubjectDraft {
  return { name: '', code: '', sortOrder: 0, description: '', isActive: true }
}

export function isCommonSubject(s: SubjectRow): boolean {
  if (s.associationType === 'ORIENTACION' && s.orientationId) return false
  return true
}

export function partitionSubjects(subjects: SubjectRow[]) {
  const common: SubjectRow[] = []
  const byOrientation = new Map<string, SubjectRow[]>()
  for (const s of subjects) {
    if (s.associationType === 'ORIENTACION' && s.orientationId) {
      const list = byOrientation.get(s.orientationId) ?? []
      list.push(s)
      byOrientation.set(s.orientationId, list)
    } else {
      common.push(s)
    }
  }
  const sortByOrder = (a: SubjectRow, b: SubjectRow) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'es')
  common.sort(sortByOrder)
  for (const [, list] of byOrientation) list.sort(sortByOrder)
  return { common, byOrientation }
}

export function courseShortLabel(name: string) {
  return name.trim()
}

export function isOfferedInCycle(course: CourseRow): boolean {
  return Boolean(course.courseOfferingId && (course.offeringIsActive ?? false) && (course.offeringIsOffered ?? true))
}

export function isVisibleInFilters(course: CourseRow): boolean {
  return isOfferedInCycle(course) && course.isActive && (course.visibleInFilters ?? true)
}

export function isOrientationOfferedInCycle(row: CourseOrientationRow): boolean {
  return row.isActive && (row.isOffered ?? true)
}
