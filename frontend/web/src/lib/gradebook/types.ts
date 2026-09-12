/** Tipos de la libreta del docente (espejo de `backend/src/routes/gradebook.ts`). */

export type GradeBookAccessLevel = 'OWNER' | 'SUBSTITUTE' | 'SUPERVISION' | 'NONE'

export type GradeBookHeader = {
  id: string
  status: 'ACTIVE' | 'ARCHIVED'
  schoolYear: { id: string; code: number; label: string }
  course: { id: string; name: string; code: string | null; level: 'EBI' | 'EMS' | null }
  courseOfferingId: string
  /** Nombre de la orientación, o null si es tronco común. */
  orientation: string | null
  subject: { id: string; name: string; code: string | null }
  teacher: { id: string; name: string | null; username: string | null } | null
}

export type RosterStudent = {
  studentId: string
  studentEnrollmentId: string
  firstName: string
  lastName: string
  documentId: string | null
  /**
   * Faltas del ciclo en **todo el liceo**, ya formateadas: `"2,5"`. No son de la asignatura: el
   * liceo cuenta las inasistencias del estudiante, no las de cada materia por separado.
   */
  absences?: string
  /** El mismo total en centésimos, para ordenar y comparar sin parsear el texto. */
  absenceHundredths?: number
  /** Cuántas de esas faltas están justificadas. */
  justifiedCount?: number
  /** Llegadas tarde acumuladas. */
  lates?: number
}

export type GradeBookDetail = GradeBookHeader & {
  access: { level: GradeBookAccessLevel; canGrade: boolean }
  studentCount: number
  students: RosterStudent[]
}

export const ACCESS_LABELS: Record<GradeBookAccessLevel, string> = {
  OWNER: 'Titular',
  SUBSTITUTE: 'Suplente',
  SUPERVISION: 'Supervisión',
  NONE: 'Sin acceso',
}
