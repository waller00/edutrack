import type { MoodleStudentState } from '@/lib/admin/students-display'

export type CourseOpt = {
  id: string
  name: string
  code: string | null
  isActive?: boolean
  offeringIsActive?: boolean | null
}

/** Fila de CourseOrientation devuelta por /courses/:courseId/orientations. */
export type OrientationOpt = {
  id: string
  orientationId: string
  orientation: { id: string; name: string; code: string | null }
}

export type MoodleAccountStatus = {
  state: MoodleStudentState
  /**
   * ¿Hay mapeo en EduTrack? Sale de `MoodleObjectMap`, no de Moodle, y es lo que distingue al
   * alumno al que nunca se le creó la cuenta de aquel cuya cuenta Moodle ya no encuentra —los dos
   * llegan como `NOT_FOUND`—.
   */
  linked: boolean
  /** Tiene email y usuario: sin eso el botón de crear la cuenta no puede hacer nada. */
  canProvision: boolean
  verified: boolean | null
  accountExists: boolean
  moodleUserId: number | null
  firstAccessAt: string | null
  welcomeSentAt: string | null
}

/** Metadatos de la foto. Los bytes se piden aparte a `GET /admin/students/:id/photo`. */
export type StudentPhotoMeta = {
  mimeType: string
  byteSize: number
  updatedAt: string
}

export type StudentListRow = {
  id: string
  /** El backend lo emite en ambas ramas del listado; nunca hay que derivarlo del id. */
  studentId: string
  enrollmentId?: string | null
  firstName: string
  lastName: string
  documentId: string | null
  schoolYearId?: string | null
  schoolYearCode?: number | null
  courseId: string | null
  course: { id: string; name: string; code: string | null } | null
  enrollmentStatus: string
  withdrawnAt: string | null
  withdrawalAcademicYear: number | null
  healthCardExpiresAt: string | null
  moodle?: MoodleAccountStatus
  photo?: StudentPhotoMeta | null
  createdAt: string
  tuitionMonthsPreview: { year: number; month: number; paid: boolean }[]
}

export type StudentTuitionMonth = {
  id?: string
  year: number
  month: number
  paid: boolean
  paidAt: string | null
  amountCents: number | null
  notes: string | null
}

export type StudentDetail = {
  id: string
  firstName: string
  lastName: string
  documentId: string | null
  courseId: string | null
  course: { id: string; name: string; code: string | null } | null
  orientationId?: string | null
  contactPhone: string | null
  tutorPhone: string | null
  username: string | null
  email: string | null
  address: string | null
  healthCardExpiresAt: string | null
  liceoAccessNotes: string | null
  enrollmentStatus: string
  withdrawnAt: string | null
  withdrawalAcademicYear: number | null
  internalNotes: string | null
  moodle: MoodleAccountStatus
  photo: StudentPhotoMeta | null
  createdAt: string
  updatedAt: string
  tuitionMonths: StudentTuitionMonth[]
}

/** Estado del formulario: el detalle sin los campos derivados ni las fechas de auditoría. */
export type StudentFormState = Omit<StudentDetail, 'course' | 'createdAt' | 'updatedAt'> & {
  createdAt?: string
  updatedAt?: string
}

export type StudentEnrollmentHistoryRow = {
  id: string
  schoolYearId: string
  schoolYearCode: number | null
  schoolYearName: string | null
  courseId: string | null
  courseName: string | null
  courseCode: string | null
  orientationId: string | null
  orientationName: string | null
  enrollmentStatus: string
  withdrawnAt: string | null
  withdrawalAcademicYear: number | null
  notes: string | null
  createdAt: string
}

export type StudentSummary = { total: number; byStatus: Record<string, number> }

export type StudentListResponse = {
  total: number
  page: number
  pageSize: number
  data: StudentListRow[]
}

export function emptyStudentDraft(): Omit<StudentFormState, 'id'> {
  return {
    firstName: '',
    lastName: '',
    documentId: null,
    courseId: null,
    orientationId: null,
    contactPhone: null,
    tutorPhone: null,
    username: null,
    email: null,
    address: null,
    healthCardExpiresAt: null,
    liceoAccessNotes: null,
    enrollmentStatus: 'ACTIVE',
    withdrawnAt: null,
    withdrawalAcademicYear: null,
    internalNotes: null,
    moodle: {
      state: 'NOT_FOUND',
      linked: false,
      canProvision: false,
      verified: false,
      accountExists: false,
      moodleUserId: null,
      firstAccessAt: null,
      welcomeSentAt: null,
    },
    photo: null,
    tuitionMonths: [],
  }
}

export function ymd(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

/** Sugerencia local de usuario `nombre.apellido`; el backend valida la definitiva. */
export function suggestUsername(firstName: string, lastName: string): string {
  const part = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s.-]/g, '')
      .trim()
      .split(/[\s.-]+/)
      .filter(Boolean)
  const first = part(firstName)[0]
  const last = part(lastName)[0]
  if (!first || !last) return ''
  return `${first}.${last}`.slice(0, 30)
}

export const STUDENT_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'WITHDRAWN', label: 'Abandonó' },
  { value: 'GRADUATED', label: 'Egresó' },
  { value: 'TRANSFERRED', label: 'Transferido' },
] as const
