import { getMappedId } from "./object-map.js";
import { resolveMoodleAcademicScope } from "./scope.js";

/**
 * Resolución del curso Moodle de una asignatura dentro de una oferta de curso.
 *
 * Los cursos Moodle se crean desde los eventos, y un evento puede traer la orientación en
 * cualquiera de sus tres formas (`courseOrientationId`, `orientationId`, o ninguna). Por eso no
 * alcanza con armar un solo `idnumber`: hay que **probar de más específico a más general** hasta
 * dar con uno que esté sincronizado.
 *
 * Es distinto de `resolveMoodleAcademicScope`, que arma un scope único a partir de un evento
 * concreto: acá el punto de partida es un filtro de la UI o una libreta, y la orientación pedida
 * puede no tener curso propio en Moodle (asignatura de tronco común dictada a toda la oferta).
 */

export type SubjectCourseLookup = {
  schoolYearId: string;
  courseOfferingId: string;
  subjectId: string;
  orientationId?: string | null;
  courseOrientationId?: string | null;
};

export type ResolvedSubjectCourse = {
  moodleCourseId: number;
  /** `idnumber` con el que se encontró el curso (útil para logs y diagnóstico de drift). */
  idnumber: string;
  /** Clave lógica del scope; es también la clave estable de la libreta. */
  scopeKey: string;
  /** Orientación con la que efectivamente se resolvió (puede ser null si cayó al curso general). */
  effectiveOrientationId: string | null;
  effectiveCourseOrientationId: string | null;
  /** `true` si se resolvió al espacio común de la asignatura, sin orientación. */
  isGeneral: boolean;
};

/**
 * Candidatos de orientación, de más específico a más general. El último —sin orientación— siempre
 * se prueba: una asignatura de tronco común se dicta a todo el curso y su curso Moodle no lleva
 * orientación, aunque el filtro sí la traiga.
 */
function orientationCandidates(lookup: SubjectCourseLookup) {
  const candidates: Array<{ courseOrientationId: string | null; orientationId: string | null }> = [];
  if (lookup.courseOrientationId) {
    candidates.push({ courseOrientationId: lookup.courseOrientationId, orientationId: null });
  }
  if (lookup.orientationId) {
    candidates.push({ courseOrientationId: null, orientationId: lookup.orientationId });
  }
  candidates.push({ courseOrientationId: null, orientationId: null });
  return candidates;
}

/** Devuelve el curso Moodle sincronizado para la asignatura, o `null` si ninguno lo está. */
export async function resolveSubjectCourse(
  lookup: SubjectCourseLookup,
): Promise<ResolvedSubjectCourse | null> {
  for (const candidate of orientationCandidates(lookup)) {
    const scope = resolveMoodleAcademicScope({
      schoolYearId: lookup.schoolYearId,
      courseOfferingId: lookup.courseOfferingId,
      subjectId: lookup.subjectId,
      orientationId: candidate.orientationId,
      courseOrientationId: candidate.courseOrientationId,
    });
    if (!scope) continue;

    const moodleCourseId = await getMappedId("SUBJECT_COURSE", scope.idnumber);
    if (moodleCourseId == null) continue;

    return {
      moodleCourseId,
      idnumber: scope.idnumber,
      scopeKey: scope.key,
      effectiveOrientationId: scope.orientationId,
      effectiveCourseOrientationId: scope.courseOrientationId,
      isGeneral: scope.isGeneral,
    };
  }
  return null;
}
