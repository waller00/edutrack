import { createHash } from "node:crypto";

/**
 * Resolución del "scope académico Moodle" de un evento.
 *
 * El acceso docente en Moodle se deriva de los eventos académicos de EduTrack. Cada combinación
 * curso(oferta) + asignatura + orientación opcional mapea a un curso Moodle distinto, de modo que
 * los permisos no se mezclan entre asignaturas ni entre orientaciones.
 *
 * Precedencia de orientación (de más específica a más general):
 *   1. `courseOrientationId` (orientación concreta de ese curso/ciclo) → curso de esa orientación.
 *   2. `orientationId` (orientación del catálogo) → curso de esa orientación.
 *   3. sin orientación → curso general de la asignatura para ese CourseOffering.
 *
 * `idnumber` es estable e idempotente (sobrevive a recreaciones de objetos en Moodle).
 */

export type EventScopeInput = {
  schoolYearId: string;
  courseOfferingId: string | null;
  subjectId: string | null;
  orientationId: string | null;
  courseOrientationId: string | null;
};

export type MoodleSubjectScope = {
  /** Clave lógica de deduplicación (coincide con el `idnumber`). */
  key: string;
  /** `idnumber` canónico del curso Moodle de la asignatura. */
  idnumber: string;
  schoolYearId: string;
  courseOfferingId: string;
  subjectId: string;
  /** Orientación efectiva aplicada (si alguna); `courseOrientationId` tiene precedencia. */
  orientationId: string | null;
  courseOrientationId: string | null;
  /** `true` si el scope corresponde al espacio común/general de la asignatura (sin orientación). */
  isGeneral: boolean;
};

const SUBJECT_PREFIX = "et-subject-offering";

/** Límite de `mdl_course.idnumber` (varchar(100)) en Moodle. */
const MOODLE_IDNUMBER_MAX = 100;

/**
 * `idnumber` seguro para Moodle (≤100 chars). El scheme natural con orientación (~142 chars) excede
 * el `varchar(100)` de `mdl_course.idnumber` y provoca `dmlwriteexception`. Cuando el idnumber lógico
 * supera el límite se reemplaza por una forma compacta y determinística derivada de la clave completa
 * (estable e idempotente). Los idnumbers base (~93 chars) quedan intactos → los cursos ya creados no
 * se recrean.
 */
function toMoodleIdnumber(logical: string): string {
  if (logical.length <= MOODLE_IDNUMBER_MAX) return logical;
  const digest = createHash("sha256").update(logical).digest("hex").slice(0, 40);
  return `et-sc-${digest}`;
}

/**
 * Devuelve el scope Moodle por asignatura del evento, o `null` si el evento no es asignable
 * a un curso por asignatura (falta `courseOfferingId` o `subjectId`). Para `subjectId` nulo
 * el llamador aplica el fallback legacy por `CourseOffering`.
 */
export function resolveMoodleAcademicScope(ev: EventScopeInput): MoodleSubjectScope | null {
  if (!ev.courseOfferingId || !ev.subjectId) return null;

  let key = `${SUBJECT_PREFIX}-${ev.courseOfferingId}-${ev.subjectId}`;
  let courseOrientationId: string | null = null;
  let orientationId: string | null = null;

  if (ev.courseOrientationId) {
    courseOrientationId = ev.courseOrientationId;
    key += `-corientation-${ev.courseOrientationId}`;
  } else if (ev.orientationId) {
    orientationId = ev.orientationId;
    key += `-orientation-${ev.orientationId}`;
  }

  return {
    key,
    idnumber: toMoodleIdnumber(key),
    schoolYearId: ev.schoolYearId,
    courseOfferingId: ev.courseOfferingId,
    subjectId: ev.subjectId,
    orientationId,
    courseOrientationId,
    isGeneral: !courseOrientationId && !orientationId,
  };
}

/** Nombre legible del curso Moodle por asignatura: "Asignatura - Curso [- Orientación] (Año)". */
export function buildSubjectCourseFullname(p: {
  subjectName: string;
  courseName: string;
  orientationName?: string | null;
  schoolYearCode: number | string;
}): string {
  const parts = [p.subjectName.trim(), p.courseName.trim()];
  const orientation = p.orientationName?.trim();
  if (orientation) parts.push(orientation);
  return `${parts.join(" - ")} (${p.schoolYearCode})`.slice(0, 254);
}
