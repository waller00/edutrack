import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
/**
 * Quién puede ver y escribir una libreta.
 *
 * - El **titular** la trabaja entera.
 * - El **suplente** oficial de alguno de sus eventos tiene un acceso **provisional**: desde su primera
 *   clase cubierta hasta `SUBSTITUTE_ACCESS_DAYS_AFTER` días después de la última. En ese tiempo ve la
 *   lista del grupo y **sólo lo que él cargó**, y puede agregar notas; nada de lo del titular (sus
 *   notas, planificación, desarrollo, conducta, rendimiento, cierre, mensajes). Eso lo marca
 *   `ownWorkOnly`, y las rutas lo cierran por defecto (`loadContext` en `routes/gradebook.ts`).
 *   Pasado el plazo, la libreta deja de ser suya: ni la lee.
 * - **Supervisión** (alcance `all`) la lee, y escribe sólo con el permiso de escribir en `all`.
 */

export type GradeBookAccessLevel = 'OWNER' | 'SUBSTITUTE' | 'SUPERVISION' | 'NONE'

export type GradeBookAccess = {
  level: GradeBookAccessLevel
  canRead: boolean
  /**
   * Evaluaciones, notas parciales, notas de período y juicios conceptuales. Para el suplente es
   * sólo agregar (y corregir) sus propias notas: lo demás se lo cierra `ownWorkOnly`.
   */
  canGrade: boolean
  /**
   * Planificación y desarrollo del curso.
   *
   * Va separado de `canGrade` porque el liceo pide que Dirección corrija la libreta de un docente
   * **salvo** las calificaciones y los juicios. Con un solo booleano no se puede expresar esa mitad.
   */
  canPlan: boolean
  /** Ve y toca sólo lo que cargó él (el suplente). */
  ownWorkOnly: boolean
  /** Último instante del acceso provisional del suplente; null para el resto. */
  substituteUntil: Date | null
}

const NO_ACCESS: GradeBookAccess = {
  level: 'NONE',
  canRead: false,
  canGrade: false,
  canPlan: false,
  ownWorkOnly: false,
  substituteUntil: null,
}

type GradeBookScope = {
  schoolYearId: string
  courseOfferingId: string
  subjectId: string
  orientationId: string | null
  courseOrientationId: string | null
}

/** Primera y última clase que quien pide cubrió como suplente en esta libreta. */
export type SubstitutionSpan = { first: Date; last: Date }

/** Días después de la última clase cubierta en que el suplente todavía entra a la libreta. */
export const SUBSTITUTE_ACCESS_DAYS_AFTER = 7

const DAY_MS = 86_400_000

/** Filtro de suplencias por el alcance de una libreta (la libreta es la unidad, no el evento). */
export function substitutionScopeWhere(gradeBook: GradeBookScope) {
  return {
    schoolYearId: gradeBook.schoolYearId,
    courseOfferingId: gradeBook.courseOfferingId,
    subjectId: gradeBook.subjectId,
    orientationId: gradeBook.orientationId,
    courseOrientationId: gradeBook.courseOrientationId,
  }
}

/**
 * ¿Quien pide fue suplente en alguna clase de esta libreta? Devuelve el rango de sus suplencias.
 *
 * Se resuelve por los eventos del scope de la libreta y no por el evento puntual: la libreta es
 * la unidad, y quien cubrió una de sus clases pertenece a ella.
 */
async function substitutionSpan(db: PrismaClient, gradeBook: GradeBookScope, userId: string): Promise<SubstitutionSpan | null> {
  const span = await db.substitution.aggregate({
    where: { substituteUserId: userId, event: substitutionScopeWhere(gradeBook) },
    _min: { date: true },
    _max: { date: true },
  })
  if (!span._min.date || !span._max.date) return null
  return { first: span._min.date, last: span._max.date }
}

/**
 * Último instante del acceso del suplente: el fin del día de su última clase cubierta más
 * `SUBSTITUTE_ACCESS_DAYS_AFTER` días. `Substitution.date` es la medianoche civil del día.
 */
export function substituteAccessUntil(span: SubstitutionSpan): Date {
  return new Date(span.last.getTime() + DAY_MS + SUBSTITUTE_ACCESS_DAYS_AFTER * DAY_MS - 1)
}

/**
 * ¿El suplente todavía entra? Desde su primera clase cubierta (no antes: una suplencia futura no
 * abre la libreta) hasta `substituteAccessUntil`. Antes el suplente leía la libreta entera para
 * siempre: quien cubrió un día de marzo seguía viendo las notas del titular en noviembre.
 */
export function isSubstituteAccessOpen(span: SubstitutionSpan, now = new Date()): boolean {
  return now.getTime() >= span.first.getTime() && now.getTime() <= substituteAccessUntil(span).getTime()
}

/**
 * Resuelve el acceso combinando el alcance del permiso con el vínculo real con la libreta.
 *
 * `scope === 'all'` (administración, adscripción, dirección) siempre lee, pero **no** califica por
 * eso: escribir notas exige además `gradebook.grade` con alcance `all`. Separar las dos preguntas
 * evita que un rol de supervisión termine escribiendo por tener alcance amplio.
 *
 * Planificar se resuelve igual pero con su propio permiso (`gradebook.plan`). Administración tiene
 * los dos y corrige cualquier libreta; Dirección y Adscripción no tienen ninguno: entran a cualquier
 * libreta, la leen y la visan u observan, pero no la editan.
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
    gradeBook: GradeBookScope & {
      teacherUserId: string | null
      status: 'ACTIVE' | 'ARCHIVED'
    }
    now?: Date
  },
  db: PrismaClient = defaultPrisma,
): Promise<GradeBookAccess> {
  const { gradeBook } = params
  const isOwner = gradeBook.teacherUserId != null && gradeBook.teacherUserId === params.userId
  // Un ciclo cerrado es de sólo lectura para todos, incluida administración (RF-110/111).
  const writable = gradeBook.status === 'ACTIVE'

  if (isOwner) {
    return {
      level: 'OWNER',
      canRead: params.readScope !== null,
      canGrade: writable && params.gradeScope !== null,
      canPlan: writable && params.planScope !== null,
      ownWorkOnly: false,
      substituteUntil: null,
    }
  }

  // Sólo se busca suplencia cuando podría cambiar la respuesta: con lectura en `all`, la rama de
  // supervisión ve más que un suplente y la consulta sería al pedo.
  const span = params.readScope === 'own' ? await substitutionSpan(db, gradeBook, params.userId) : null
  if (span && isSubstituteAccessOpen(span, params.now)) {
    return {
      level: 'SUBSTITUTE',
      canRead: true,
      // Agregar sus notas; C, R, cierre y planificación se los cierra `ownWorkOnly`.
      canGrade: writable && params.gradeScope !== null,
      canPlan: false,
      ownWorkOnly: true,
      substituteUntil: substituteAccessUntil(span),
    }
  }

  // Supervisión escribe sólo con alcance `all`: el permiso `own` no alcanza sobre libreta ajena.
  if (params.readScope === 'all') {
    return {
      level: 'SUPERVISION',
      canRead: true,
      canGrade: writable && params.gradeScope === 'all',
      canPlan: writable && params.planScope === 'all',
      ownWorkOnly: false,
      substituteUntil: null,
    }
  }

  return NO_ACCESS
}
