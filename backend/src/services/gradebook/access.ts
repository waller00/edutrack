import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
/**
 * Quién puede ver y escribir una libreta.
 *
 * Espeja `isResponsibleTeacher` del pase de lista: titular **o** suplente oficial de alguno de sus
 * eventos. Un suplente que cubrió una clase tiene que poder cargar la nota de ese día sin que
 * administración lo habilite a mano.
 */

export type GradeBookAccessLevel = 'OWNER' | 'SUBSTITUTE' | 'SUPERVISION' | 'NONE'

export type GradeBookAccess = {
  level: GradeBookAccessLevel
  canRead: boolean
  canGrade: boolean
}

const NO_ACCESS: GradeBookAccess = { level: 'NONE', canRead: false, canGrade: false }

/**
 * ¿Quien pide fue suplente en alguna clase de esta libreta?
 *
 * Se resuelve por los eventos del scope de la libreta y no por el evento puntual: la libreta es
 * la unidad, y quien cubrió una de sus clases pertenece a ella.
 *
 * Alcance deliberado: da acceso a la libreta entera, no sólo al día suplido. Para leer el grupo
 * es lo correcto; cuando lleguen las evaluaciones (que sí llevan fecha) la escritura tendrá que
 * acotarse a la ventana de la suplencia, porque si no un suplente de un día de marzo podría
 * calificar todo el año.
 */
async function hasSubstitution(
  db: PrismaClient,
  gradeBook: { schoolYearId: string; courseOfferingId: string; subjectId: string; orientationId: string | null; courseOrientationId: string | null },
  userId: string,
): Promise<boolean> {
  const found = await db.substitution.findFirst({
    where: {
      substituteUserId: userId,
      event: {
        schoolYearId: gradeBook.schoolYearId,
        courseOfferingId: gradeBook.courseOfferingId,
        subjectId: gradeBook.subjectId,
        orientationId: gradeBook.orientationId,
        courseOrientationId: gradeBook.courseOrientationId,
      },
    },
    select: { id: true },
  })
  return Boolean(found)
}

/**
 * Resuelve el acceso combinando el alcance del permiso con el vínculo real con la libreta.
 *
 * `scope === 'all'` (administración, adscripción, dirección, inspección) siempre lee, pero **no**
 * califica por eso: escribir notas exige `gradebook.grade`, que esos roles no tienen. Separar las
 * dos preguntas evita que un rol de supervisión termine escribiendo por tener alcance amplio.
 */
export async function resolveGradeBookAccess(
  params: {
    userId: string
    /** Alcance de `gradebook.read` de quien pide. */
    readScope: 'own' | 'all' | null
    /** Alcance de `gradebook.grade`; null si no lo tiene. */
    gradeScope: 'own' | 'all' | null
    gradeBook: {
      teacherUserId: string | null
      schoolYearId: string
      courseOfferingId: string
      subjectId: string
      orientationId: string | null
      courseOrientationId: string | null
      status: 'ACTIVE' | 'ARCHIVED'
    }
  },
  db: PrismaClient = defaultPrisma,
): Promise<GradeBookAccess> {
  const { gradeBook } = params
  const isOwner = gradeBook.teacherUserId != null && gradeBook.teacherUserId === params.userId
  // Un ciclo cerrado es de sólo lectura para todos, incluida administración (RF-110/111).
  const writable = gradeBook.status === 'ACTIVE'

  if (isOwner) {
    return { level: 'OWNER', canRead: params.readScope !== null, canGrade: writable && params.gradeScope !== null }
  }

  if (params.gradeScope !== null || params.readScope === 'own') {
    const substitute = await hasSubstitution(db, gradeBook, params.userId)
    if (substitute) {
      return {
        level: 'SUBSTITUTE',
        canRead: params.readScope !== null,
        canGrade: writable && params.gradeScope !== null,
      }
    }
  }

  if (params.readScope === 'all') {
    return { level: 'SUPERVISION', canRead: true, canGrade: writable && params.gradeScope === 'all' }
  }

  return NO_ACCESS
}
