import { describe, expect, it } from "vitest";
import { resolveMoodleAcademicScope } from "./scope.js";
import {
  buildLiveSubjectCourseIdnumbers,
  classifyCategory,
  classifyCourse,
  classifyStudent,
  isEtIdnumber,
  type DbIds,
} from "./orphan-idnumbers.js";

const OFFERING = "11111111-1111-4111-8111-111111111111";
const OFFERING_MUERTA = "99999999-9999-4999-8999-999999999999";
const SUBJECT = "22222222-2222-4222-8222-222222222222";
const CORIENTATION = "33333333-3333-4333-8333-333333333333";
const ORIENTATION = "44444444-4444-4444-8444-444444444444";
const YEAR = "55555555-5555-4555-8555-555555555555";
const STUDENT = "66666666-6666-4666-8666-666666666666";

const db: DbIds = {
  years: new Set([YEAR]),
  offerings: new Set([OFFERING]),
  subjects: new Set([SUBJECT]),
  courseOrientations: new Set([CORIENTATION]),
  orientations: new Set([ORIENTATION]),
  students: new Set([STUDENT]),
};

const liveSources = {
  offerings: [{ id: OFFERING, schoolYearId: YEAR }],
  subjectIds: [SUBJECT],
  courseOrientationIds: [CORIENTATION],
  orientationIds: [ORIENTATION],
};

/** El idnumber real que produce `scope.ts` para un scope dado (compacto si supera 100 chars). */
function idnumberFor(input: { courseOrientationId?: string; orientationId?: string }) {
  return resolveMoodleAcademicScope({
    schoolYearId: YEAR,
    courseOfferingId: OFFERING,
    subjectId: SUBJECT,
    courseOrientationId: input.courseOrientationId ?? null,
    orientationId: input.orientationId ?? null,
  })!.idnumber;
}

describe("buildLiveSubjectCourseIdnumbers", () => {
  it("cubre el curso general y el de cada orientación", () => {
    const live = buildLiveSubjectCourseIdnumbers(liveSources);

    expect(live.has(idnumberFor({}))).toBe(true);
    expect(live.has(idnumberFor({ courseOrientationId: CORIENTATION }))).toBe(true);
    expect(live.has(idnumberFor({ orientationId: ORIENTATION }))).toBe(true);
    // general + corientation + orientation
    expect(live.size).toBe(3);
  });

  it("no incluye combinaciones de datos que ya no existen", () => {
    const live = buildLiveSubjectCourseIdnumbers(liveSources);

    const muerto = resolveMoodleAcademicScope({
      schoolYearId: YEAR,
      courseOfferingId: OFFERING_MUERTA,
      subjectId: SUBJECT,
      courseOrientationId: CORIENTATION,
      orientationId: null,
    })!.idnumber;

    expect(live.has(muerto)).toBe(false);
  });
});

describe("classifyCourse", () => {
  const live = buildLiveSubjectCourseIdnumbers(liveSources);

  it("conserva el curso por asignatura vigente", () => {
    expect(classifyCourse(idnumberFor({}), db, live).orphan).toBe(false);
  });

  it("marca huérfano el curso de una oferta que ya no existe", () => {
    const v = classifyCourse(`et-subject-offering-${OFFERING_MUERTA}-${SUBJECT}`, db, live);
    expect(v.orphan).toBe(true);
    expect(v.reason).toContain("oferta inexistente");
  });

  it("marca huérfano el curso de una orientación-curso que ya no existe", () => {
    const idnumber = `et-subject-offering-${OFFERING}-${SUBJECT}-corientation-${OFFERING_MUERTA}`;
    // El scheme con orientación supera los 100 chars → scope.ts lo compacta; acá se prueba la forma
    // legible por si alguna instalación vieja la tiene guardada tal cual.
    const v = classifyCourse(idnumber, db, live);
    expect(v.orphan).toBe(true);
    expect(v.reason).toContain("orientación-curso inexistente");
  });

  describe("forma compacta et-sc-<hash> (el hash no es reversible)", () => {
    it("conserva la que corresponde a datos vivos", () => {
      const idnumber = idnumberFor({ courseOrientationId: CORIENTATION });
      expect(idnumber.startsWith("et-sc-")).toBe(true);

      expect(classifyCourse(idnumber, db, live).orphan).toBe(false);
    });

    it("marca huérfana la que ningún dato vivo puede generar", () => {
      const muerto = resolveMoodleAcademicScope({
        schoolYearId: YEAR,
        courseOfferingId: OFFERING_MUERTA,
        subjectId: SUBJECT,
        courseOrientationId: CORIENTATION,
        orientationId: null,
      })!.idnumber;
      expect(muerto.startsWith("et-sc-")).toBe(true);

      const v = classifyCourse(muerto, db, live);
      expect(v.orphan).toBe(true);
      expect(v.reason).toContain("sin dato vivo");
    });
  });

  it("marca huérfano el esquema legacy", () => {
    const v = classifyCourse("et-subject-h-abc123", db, live);
    expect(v.orphan).toBe(true);
    expect(v.reason).toContain("legacy");
  });

  it("no toca un patrón et- desconocido", () => {
    const v = classifyCourse("et-experimento-manual", db, live);
    expect(v.orphan).toBe(false);
    expect(v.reason).toContain("desconocido");
  });
});

describe("classifyCategory y classifyStudent", () => {
  it("distingue ciclo lectivo vigente de inexistente", () => {
    expect(classifyCategory(`et-year-${YEAR}`, db).orphan).toBe(false);
    expect(classifyCategory(`et-year-${OFFERING_MUERTA}`, db).orphan).toBe(true);
  });

  it("distingue estudiante vigente de inexistente", () => {
    expect(classifyStudent(`et-student-${STUDENT}`, db).orphan).toBe(false);
    expect(classifyStudent(`et-student-${OFFERING_MUERTA}`, db).orphan).toBe(true);
  });

  it("no toca categorías ni estudiantes con patrón desconocido", () => {
    expect(classifyCategory("et-otra-cosa", db).orphan).toBe(false);
    expect(classifyStudent("et-otra-cosa", db).orphan).toBe(false);
  });
});

describe("isEtIdnumber", () => {
  it("solo reconoce lo que creó EduTrack", () => {
    expect(isEtIdnumber("et-year-x")).toBe(true);
    expect(isEtIdnumber("curso-creado-a-mano")).toBe(false);
    expect(isEtIdnumber(undefined)).toBe(false);
    expect(isEtIdnumber(null)).toBe(false);
  });
});
