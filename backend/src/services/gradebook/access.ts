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
  /** Evaluaciones, notas parciales, notas de período y juicios conceptuales. */
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

type GradeBookScope = {
  schoolYearId: string
  courseOfferingId: string
  subjectId: string
  orientationId: string | null
  courseOrientationId: string | null
}

/** Primera y última clase que quien pide cubrió como suplente en esta libreta. */
export type SubstitutionSpan = { first: Date; last: Date }

/**
 * ¿Quien pide fue suplente en alguna clase de esta libreta? Devuelve el rango de sus suplencias.
 *
 * Se resuelve por los eventos del scope de la libreta y no por el evento puntual: la libreta es
 * la unidad, y quien cubrió una de sus clases pertenece a ella.
 */
async function substitutionSpan(db: PrismaClient, gradeBook: GradeBookScope, userId: string): Promise<SubstitutionSpan | null> {
  const span = await db.substitution.aggregate({
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
    _min: { date: true },
    _max: { date: true },
  })
  if (!span._min.date || !span._max.date) return null
  return { first: span._min.date, last: span._max.date }
}

const DAY_MS = 86_400_000

/**
 * ¿El suplente todavía puede escribir? Leer, lee la libreta entera siempre; escribir, sólo desde su
 * primera clase hasta el día después de la última más la ventana de edición de notas (la misma que
 * tiene el titular para una evaluación). Antes la escritura no tenía límite: quien cubrió un día de
 * marzo podía calificar, poner C y R y cerrar períodos todo el año.
 */
export function isSubstitutionWriteOpen(span: SubstitutionSpan, windowDays: number, now = new Date()): boolean {
  const opensAt = span.first.getTime()
  const closesAt = span.last.getTime() + DAY_MS + windowDays * DAY_MS
  return now.getTime() >= opensAt && now.getTime() <= closesAt
}

/**
 * Resuelve el acceso combinando el alcance del permiso con el vínculo real con la libreta.
 *
 * `scope === 'all'` (administración, adscripción, dirección, inspección) siempre lee, pero **no**
 * califica por eso: escribir notas exige `gradebook.grade`, que esos roles no tienen. Separar las
 * dos preguntas evita que un rol de supervisión termine escribiendo por tener alcance amplio.
 *
 * Planificar se resuelve igual pero con su propio permiso (`gradebook.plan`). Dirección no tiene
 * ninguno de los dos: entra a cualquier libreta, la lee y la visa, pero no la edita.
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
    /** Ventana de edición de notas en días (`getGradeBookSettings().editWindowDays`). Acota al suplente. */
    editWindowDays: number
    now?: Date
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

  const span = substitutionCouldHelp ? await substitutionSpan(db, gradeBook, params.userId) : null
  if (span) {
    if (isSubstitutionWriteOpen(span, params.editWindowDays, params.now)) {
      return { level: 'SUBSTITUTE', ...ownWrite }
    }
    // Fuera de su ventana el suplente sigue leyendo, pero no escribe. Si además supervisa, que
    // decida la rama de supervisión.
    if (params.readScope !== 'all') {
      return { level: 'SUBSTITUTE', canRead: params.readScope !== null, canGrade: false, canPlan: false }
    }
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
