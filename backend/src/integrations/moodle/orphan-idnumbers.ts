import { resolveMoodleAcademicScope } from "./scope.js";

/**
 * Clasificación de `idnumber` de objetos EduTrack en Moodle: decide si un curso/categoría/estudiante
 * remoto sigue respaldado por datos vivos o quedó huérfano (típico tras reseedear la base de demo,
 * donde los UUIDs cambian y los objetos de Moodle quedan colgados).
 *
 * Vive en `src/` y no en el script de limpieza porque es lógica de dominio y necesita cobertura de
 * tests (vitest solo levanta `src/**` y `prisma/**`).
 *
 * Los idnumbers legibles (`et-subject-offering-<uuid>-<uuid>…`) se clasifican parseando sus UUIDs.
 * Los compactos (`et-sc-<sha256>`, que `scope.ts` genera cuando la clave lógica supera los 100 chars
 * del `varchar` de Moodle) NO son reversibles: se resuelven por pertenencia al conjunto de idnumbers
 * que los datos vivos podrían generar (ver `buildLiveSubjectCourseIdnumbers`).
 */

export type Verdict = { orphan: boolean; reason: string };

export type DbIds = {
  years: Set<string>;
  offerings: Set<string>;
  subjects: Set<string>;
  courseOrientations: Set<string>;
  orientations: Set<string>;
  students: Set<string>;
};

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const RE_OFFERING = new RegExp(`^et-offering-(${UUID})$`);
const RE_SUBJECT = new RegExp(
  `^et-subject-offering-(${UUID})-(${UUID})(?:-corientation-(${UUID}))?(?:-orientation-(${UUID}))?$`,
);
const RE_YEAR = new RegExp(`^et-year-(${UUID})$`);
const RE_STUDENT = new RegExp(`^et-student-(${UUID})$`);

/** Prefijo de la forma compacta de `scope.ts` (`et-sc-<sha256[0..40]>`). */
export const HASHED_SUBJECT_COURSE_PREFIX = "et-sc-";

// Esquemas de idnumber que el código actual ya NO genera: cualquier objeto con estos prefijos es
// de una versión vieja de la integración y, por definición, huérfano (no lo produce ningún dato vivo).
const LEGACY_COURSE_PREFIXES = ["et-subject-h-"];

export type LiveScopeSources = {
  offerings: Array<{ id: string; schoolYearId: string }>;
  subjectIds: string[];
  courseOrientationIds: string[];
  orientationIds: string[];
};

/**
 * Conjunto de `idnumber` de cursos por asignatura que los datos vivos podrían generar.
 *
 * Es deliberadamente un SUPERCONJUNTO (producto cartesiano oferta × asignatura × orientación) y no
 * una réplica de a qué cursos llega hoy la reconciliación: la garantía que importa acá es la inversa
 * —si un idnumber NO está en este conjunto, ningún dato vivo pudo haberlo producido y borrarlo es
 * seguro—. Ser generoso solo puede dejar basura sin borrar; ser estricto podría borrar un curso vivo.
 */
export function buildLiveSubjectCourseIdnumbers(sources: LiveScopeSources): Set<string> {
  const orientationCombos: Array<{ orientationId: string | null; courseOrientationId: string | null }> = [
    { orientationId: null, courseOrientationId: null },
    ...sources.courseOrientationIds.map((id) => ({ orientationId: null, courseOrientationId: id })),
    ...sources.orientationIds.map((id) => ({ orientationId: id, courseOrientationId: null })),
  ];

  const idnumbers = new Set<string>();
  for (const offering of sources.offerings) {
    for (const subjectId of sources.subjectIds) {
      for (const combo of orientationCombos) {
        const scope = resolveMoodleAcademicScope({
          schoolYearId: offering.schoolYearId,
          courseOfferingId: offering.id,
          subjectId,
          ...combo,
        });
        if (scope) idnumbers.add(scope.idnumber);
      }
    }
  }
  return idnumbers;
}

/** Decide si un curso `et-*` es huérfano según los ids vivos en la base actual. */
export function classifyCourse(idnumber: string, db: DbIds, liveSubjectCourseIdnumbers: Set<string>): Verdict {
  const offering = RE_OFFERING.exec(idnumber);
  if (offering) {
    const id = offering[1]!;
    return db.offerings.has(id)
      ? { orphan: false, reason: "oferta vigente" }
      : { orphan: true, reason: `oferta inexistente (${id})` };
  }

  const subject = RE_SUBJECT.exec(idnumber);
  if (subject) {
    const [, offeringId, subjectId, corientationId, orientationId] = subject;
    if (!db.offerings.has(offeringId!)) return { orphan: true, reason: `oferta inexistente (${offeringId})` };
    if (!db.subjects.has(subjectId!)) return { orphan: true, reason: `asignatura inexistente (${subjectId})` };
    if (corientationId && !db.courseOrientations.has(corientationId)) {
      return { orphan: true, reason: `orientación-curso inexistente (${corientationId})` };
    }
    if (orientationId && !db.orientations.has(orientationId)) {
      return { orphan: true, reason: `orientación inexistente (${orientationId})` };
    }
    return { orphan: false, reason: "curso por asignatura vigente" };
  }

  // Forma compacta: el hash no se puede revertir, así que se resuelve por pertenencia al conjunto
  // de idnumbers que los datos vivos podrían generar.
  if (idnumber.startsWith(HASHED_SUBJECT_COURSE_PREFIX)) {
    return liveSubjectCourseIdnumbers.has(idnumber)
      ? { orphan: false, reason: "curso por asignatura vigente (idnumber compacto)" }
      : { orphan: true, reason: "idnumber compacto sin dato vivo que lo genere" };
  }

  if (LEGACY_COURSE_PREFIXES.some((p) => idnumber.startsWith(p))) {
    return { orphan: true, reason: "esquema viejo de idnumber (legacy, ya no se usa)" };
  }

  return { orphan: false, reason: "patrón et- desconocido (no se toca)" };
}

export function classifyCategory(idnumber: string, db: DbIds): Verdict {
  const year = RE_YEAR.exec(idnumber);
  if (year) {
    const id = year[1]!;
    return db.years.has(id)
      ? { orphan: false, reason: "ciclo lectivo vigente" }
      : { orphan: true, reason: `ciclo lectivo inexistente (${id})` };
  }
  return { orphan: false, reason: "patrón et- desconocido (no se toca)" };
}

export function classifyStudent(idnumber: string, db: DbIds): Verdict {
  const student = RE_STUDENT.exec(idnumber);
  if (student) {
    const id = student[1]!;
    return db.students.has(id)
      ? { orphan: false, reason: "estudiante vigente" }
      : { orphan: true, reason: `estudiante inexistente (${id})` };
  }
  return { orphan: false, reason: "patrón et- desconocido (no se toca)" };
}

/** `true` si el idnumber lo generó EduTrack (nunca se toca nada creado a mano en Moodle). */
export function isEtIdnumber(idnumber?: string | null): idnumber is string {
  return Boolean(idnumber && idnumber.startsWith("et-"));
}
