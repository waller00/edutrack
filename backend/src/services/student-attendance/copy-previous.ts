import type { StudentAttendanceStatus } from '@prisma/client'
import { prisma } from '../../db/prisma.js'

/**
 * Clave de grupo. Espeja `groupKeyOf` de services/events/event-overlap.ts, que es el único
 * identificador de cohorte que ya existía en el código.
 */
export function groupKeyOf(scope: { courseOfferingId: string | null; courseOrientationId: string | null }): string | null {
  return scope.courseOrientationId ?? scope.courseOfferingId
}

/**
 * Filtro de la clase anterior del mismo grupo ese mismo día.
 *
 * La rama de tronco común exige `courseOrientationId: null` a propósito: una clase común NO
 * debe heredar de una de orientación, que abarca menos alumnos, o quedarían sistemáticamente
 * estudiantes sin marcar. Asignatura y docente se ignoran: si a primera hora ya pasaron
 * lista, ese estado sirve igual para la segunda.
 */
export function buildPreviousSessionWhere(params: {
  occurrenceYmd: string
  currentStartAt: Date
  currentSessionId: string | null
  courseOfferingId: string | null
  courseOrientationId: string | null
}): Record<string, unknown> {
  const where: Record<string, unknown> = {
    occurrenceYmd: params.occurrenceYmd,
    status: 'TAKEN',
    endAt: { lte: params.currentStartAt },
  }
  if (params.currentSessionId) where.NOT = { id: params.currentSessionId }
  if (params.courseOrientationId) where.courseOrientationId = params.courseOrientationId
  else {
    where.courseOfferingId = params.courseOfferingId
    where.courseOrientationId = null
  }
  return where
}

export type CopySuggestion = { studentId: string; status: StudentAttendanceStatus }

export type CopyProjection = {
  suggestions: CopySuggestion[]
  /** Alumnos del roster actual que no estaban en la hora anterior: quedan sin marcar. */
  newStudentIds: string[]
}

/**
 * Proyecta los estados de la hora anterior sobre el roster actual.
 *
 * `ABSENT_JUSTIFIED` se degrada a `ABSENT`: una justificación es un acto administrativo
 * sobre UNA ocurrencia concreta y no se hereda a la hora siguiente.
 * Los alumnos que no estaban antes se listan aparte para que el docente decida: pudo entrar
 * un alumno nuevo, o venir de otro grupo.
 */
export function projectPreviousStatuses(
  previous: readonly { studentId: string; status: StudentAttendanceStatus }[],
  roster: readonly { studentId: string }[],
): CopyProjection {
  const byStudent = new Map(previous.map((e) => [e.studentId, e.status]))
  const suggestions: CopySuggestion[] = []
  const newStudentIds: string[] = []

  for (const student of roster) {
    const status = byStudent.get(student.studentId)
    if (!status) {
      newStudentIds.push(student.studentId)
      continue
    }
    suggestions.push({ studentId: student.studentId, status: status === 'ABSENT_JUSTIFIED' ? 'ABSENT' : status })
  }

  return { suggestions, newStudentIds }
}

export async function findPreviousSession(
  params: Parameters<typeof buildPreviousSessionWhere>[0],
  db = prisma,
) {
  return db.studentAttendanceSession.findFirst({
    where: buildPreviousSessionWhere(params) as never,
    orderBy: { endAt: 'desc' },
    include: {
      entries: { select: { studentId: true, status: true } },
      subject: { select: { name: true } },
      takenBy: { select: { id: true, name: true, username: true } },
    },
  })
}
