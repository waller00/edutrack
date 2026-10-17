import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { uruguayWallToUtc } from '../../config/app-timezone.js'
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
  /** Capacidad general; cada escritura debe validar además la cobertura de la suplencia. */
  canGrade: boolean
  /**
   * Planificación y desarrollo del curso.
   *
   * Va separado de `canGrade` porque el liceo pide que Dirección corrija la libreta de un docente
   * **salvo** las calificaciones y los juicios. Con un solo booleano no se puede expresar esa mitad.
   */
  canPlan: boolean
}

const NO_ACCESS: GradeBookAccess = { level: 'NONE', canRead: false, canGrade: false, canPlan: false }

/**
 * ¿Quien pide fue suplente en alguna clase de esta libreta?
 *
 * Se resuelve por los eventos del scope de la libreta y no por el evento puntual: la libreta es
 * la unidad, y quien cubrió una de sus clases pertenece a ella.
 *
 * Da lectura histórica a la libreta. La escritura se valida por separado con
 * canWriteGradeBookGrades: haber cubierto una clase no autoriza a calificar todo el año.
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
 *
 * Planificar se resuelve igual pero con su propio permiso: Dirección tiene `gradebook.plan` con
 * alcance `all` y no tiene `gradebook.grade`, así que entra a una libreta ajena, edita la
 * planificación y el desarrollo, y no puede tocar una nota.
 */
export async function resolveGradeBookAccess(
  params: {
    userId: string
    /** Alcance de `gradebook.read` de quien pide. */
    readScope: 'own' | 'all' | null
    /** Alcance de `gradebook.grade`; null si no lo tiene. */
    gradeScope: 'own' | 'all' | null
    /** Alcance de `gradebook.plan`; null si no lo tiene. */
    planScope: 'own' | 'all' | null
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

  // Titular y suplente escriben por vínculo: les alcanza con tener el permiso en cualquier alcance.
  const ownWrite = {
    canRead: params.readScope !== null,
    canGrade: writable && params.gradeScope !== null,
    canPlan: writable && params.planScope !== null,
  }

  if (isOwner) {
    return { level: 'OWNER', ...ownWrite }
  }

  // Sólo se busca suplencia cuando podría cambiar la respuesta: con todos los alcances en `all`,
  // la rama de supervisión de abajo ya concede lo mismo y la consulta sería al pedo. Con un
  // permiso en `own`, en cambio, ser suplente es la única forma de escribir esta libreta.
  const substitutionCouldHelp =
    params.readScope === 'own' || params.gradeScope === 'own' || params.planScope === 'own'

  if (substitutionCouldHelp && (await hasSubstitution(db, gradeBook, params.userId))) {
    return { level: 'SUBSTITUTE', ...ownWrite }
  }

  // Supervisión escribe sólo con alcance `all`: el permiso `own` no alcanza sobre libreta ajena.
  if (params.readScope === 'all') {
    return {
      level: 'SUPERVISION',
      canRead: true,
      canGrade: writable && params.gradeScope === 'all',
      canPlan: writable && params.planScope === 'all',
    }
  }

  return NO_ACCESS
}

/**
 * Autorización de escritura por objeto, independiente de la ventana de edición.
 * Assessment.date es un día civil (serializado como YYYY-MM-DD en UTC), mientras
 * Substitution.date guarda el inicio del día institucional. No comparar sus
 * timestamps directamente ni convertir medianoche UTC al día local anterior.
 * Sin fecha (períodos, cierres, importación masiva) una suplencia no da permiso.
 */
export async function canWriteGradeBookGrades(params: {
  access: GradeBookAccess
  gradeScope: 'own' | 'all' | null
  userId: string
  gradeBook: {
    schoolYearId: string
    courseOfferingId: string
    subjectId: string
    orientationId: string | null
    courseOrientationId: string | null
  }
  assessmentDate?: Date
}, db: PrismaClient = defaultPrisma): Promise<boolean> {
  if (!params.access.canGrade || params.gradeScope === null) return false
  if (params.access.level !== 'SUBSTITUTE' || params.gradeScope === 'all') return true
  const date = params.assessmentDate
  if (!date || !Number.isFinite(date.getTime())) return false
  const found = await db.substitution.findFirst({
    where: {
      substituteUserId: params.userId,
      date: uruguayWallToUtc(date.toISOString().slice(0, 10), 0, 0),
      event: {
        schoolYearId: params.gradeBook.schoolYearId,
        courseOfferingId: params.gradeBook.courseOfferingId,
        subjectId: params.gradeBook.subjectId,
        orientationId: params.gradeBook.orientationId,
        courseOrientationId: params.gradeBook.courseOrientationId,
      },
    },
    select: { id: true },
  })
  return Boolean(found)
}
