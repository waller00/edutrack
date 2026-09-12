import { prisma } from '../../db/prisma.js'

export type RosterScope = {
  schoolYearId: string
  courseOfferingId: string
  orientationId: string | null
  courseOrientationId: string | null
}

export type RosterStudent = {
  studentId: string
  studentEnrollmentId: string
  firstName: string
  lastName: string
  documentId: string | null
}

/**
 * Filtro de matrículas que forman la cohorte de una clase.
 *
 * Espeja la precedencia de `resolveMoodleAcademicScope` (integrations/moodle/scope.ts):
 * `courseOrientationId` > `orientationId` > tronco común. En tronco común NO se filtra por
 * orientación a propósito: una asignatura común se dicta a todo el curso, así que el roster
 * del pase de lista coincide con el conjunto que se matricula en Moodle.
 */
export function buildRosterEnrollmentWhere(scope: RosterScope): Record<string, unknown> {
  const where: Record<string, unknown> = {
    schoolYearId: scope.schoolYearId,
    courseOfferingId: scope.courseOfferingId,
    enrollmentStatus: 'ACTIVE',
  }
  if (scope.courseOrientationId) where.courseOrientationId = scope.courseOrientationId
  else if (scope.orientationId) where.orientationId = scope.orientationId
  return where
}

/** Indica si el evento tiene cohorte resoluble (sin oferta de curso no hay a quién listar). */
export function canResolveRoster(event: {
  schoolYearId?: string | null
  courseOfferingId?: string | null
}): boolean {
  return Boolean(event.schoolYearId && event.courseOfferingId)
}

/**
 * Estudiantes activos de la cohorte, ordenados como se leen en clase (apellido, nombre).
 *
 * Es la única forma correcta de resolver una cohorte: filtrar solo por `courseOfferingId`, sin
 * ciclo ni orientación, devuelve el conjunto equivocado en cualquier clase de orientación (el
 * bug que tenía el puente de notas que se dio de baja). Cualquier módulo que necesite el listado
 * de un grupo —pase de lista, libreta— debe pasar por acá.
 */
export async function loadRosterForScope(scope: RosterScope, db = prisma): Promise<RosterStudent[]> {
  const rows = await db.studentEnrollment.findMany({
    where: buildRosterEnrollmentWhere(scope) as never,
    select: {
      id: true,
      student: { select: { id: true, firstName: true, lastName: true, documentId: true } },
    },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
  })
  return rows
    .filter((row) => row.student)
    .map((row) => ({
      studentId: row.student.id,
      studentEnrollmentId: row.id,
      firstName: row.student.firstName,
      lastName: row.student.lastName,
      documentId: row.student.documentId ?? null,
    }))
}
