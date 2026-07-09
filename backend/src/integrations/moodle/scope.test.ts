import { describe, it, expect } from "vitest";
import {
  buildSubjectCourseFullname,
  resolveMoodleAcademicScope,
} from "./scope.js";

const base = {
  schoolYearId: "sy1",
  courseOfferingId: "off1",
  subjectId: "subjMat",
  orientationId: null,
  courseOrientationId: null,
};

describe("resolveMoodleAcademicScope", () => {
  it("asignatura general (sin orientación) → idnumber por oferta+asignatura", () => {
    const scope = resolveMoodleAcademicScope(base);
    expect(scope).not.toBeNull();
    expect(scope!.idnumber).toBe("et-subject-offering-off1-subjMat");
    expect(scope!.isGeneral).toBe(true);
    expect(scope!.orientationId).toBeNull();
    expect(scope!.courseOrientationId).toBeNull();
  });

  it("con orientationId → idnumber con sufijo de orientación", () => {
    const scope = resolveMoodleAcademicScope({ ...base, orientationId: "ori1" });
    expect(scope!.idnumber).toBe("et-subject-offering-off1-subjMat-orientation-ori1");
    expect(scope!.isGeneral).toBe(false);
    expect(scope!.orientationId).toBe("ori1");
  });

  it("con courseOrientationId → idnumber con sufijo corientation", () => {
    const scope = resolveMoodleAcademicScope({ ...base, courseOrientationId: "co1" });
    expect(scope!.idnumber).toBe("et-subject-offering-off1-subjMat-corientation-co1");
    expect(scope!.courseOrientationId).toBe("co1");
  });

  it("courseOrientationId tiene precedencia sobre orientationId", () => {
    const scope = resolveMoodleAcademicScope({
      ...base,
      orientationId: "ori1",
      courseOrientationId: "co1",
    });
    expect(scope!.idnumber).toBe("et-subject-offering-off1-subjMat-corientation-co1");
    expect(scope!.orientationId).toBeNull();
    expect(scope!.courseOrientationId).toBe("co1");
  });

  it("idnumbers distintos no mezclan asignaturas ni orientaciones", () => {
    const general = resolveMoodleAcademicScope(base)!.idnumber;
    const otraAsig = resolveMoodleAcademicScope({ ...base, subjectId: "subjLit" })!.idnumber;
    const conOri = resolveMoodleAcademicScope({ ...base, orientationId: "ori1" })!.idnumber;
    expect(new Set([general, otraAsig, conOri]).size).toBe(3);
  });

  it("devuelve null si falta courseOfferingId o subjectId (fallback legacy)", () => {
    expect(resolveMoodleAcademicScope({ ...base, courseOfferingId: null })).toBeNull();
    expect(resolveMoodleAcademicScope({ ...base, subjectId: null })).toBeNull();
  });
});

describe("resolveMoodleAcademicScope · idnumber ≤100 (mdl_course.idnumber varchar(100))", () => {
  // UUIDs reales de 36 chars, como en producción.
  const uuids = {
    schoolYearId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    courseOfferingId: "11111111-2222-4333-8444-555555555555",
    subjectId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    orientationId: null,
    courseOrientationId: null,
  };

  it("base con UUIDs (~93 chars) entra en 100 y queda intacto (no recrea cursos existentes)", () => {
    const scope = resolveMoodleAcademicScope(uuids)!;
    expect(scope.idnumber.length).toBeLessThanOrEqual(100);
    // El scheme natural base no se toca → los 39 cursos ya creados siguen mapeados.
    expect(scope.idnumber).toBe(scope.key);
    expect(scope.idnumber).toBe(
      "et-subject-offering-11111111-2222-4333-8444-555555555555-66666666-7777-4888-8999-aaaaaaaaaaaa",
    );
  });

  it("con orientación (~142 chars) se compacta a ≤100 con prefijo et-sc-, conservando la key lógica", () => {
    const scope = resolveMoodleAcademicScope({
      ...uuids,
      courseOrientationId: "cccccccc-dddd-4eee-8fff-000000000000",
    })!;
    expect(scope.key.length).toBeGreaterThan(100); // el idnumber lógico sí excede el varchar(100)
    expect(scope.idnumber.length).toBeLessThanOrEqual(100);
    expect(scope.idnumber.startsWith("et-sc-")).toBe(true);
    expect(scope.key).toContain("-corientation-cccccccc-dddd-4eee-8fff-000000000000");
  });

  it("la compactación es determinística y no colisiona entre orientaciones", () => {
    const a1 = resolveMoodleAcademicScope({ ...uuids, courseOrientationId: "co-aaaa" })!.idnumber;
    const a2 = resolveMoodleAcademicScope({ ...uuids, courseOrientationId: "co-aaaa" })!.idnumber;
    const b = resolveMoodleAcademicScope({ ...uuids, courseOrientationId: "co-bbbb" })!.idnumber;
    expect(a1).toBe(a2); // idempotente
    expect(a1).not.toBe(b); // sin colisión
  });
});

describe("buildSubjectCourseFullname", () => {
  it("asignatura general: 'Asignatura - Curso (Año)'", () => {
    expect(
      buildSubjectCourseFullname({
        subjectName: "Matemática",
        courseName: "4to EMS",
        schoolYearCode: 2026,
      }),
    ).toBe("Matemática - 4to EMS (2026)");
  });

  it("con orientación: 'Asignatura - Curso - Orientación (Año)'", () => {
    expect(
      buildSubjectCourseFullname({
        subjectName: "Biología",
        courseName: "4to EMS",
        orientationName: "Ciencias Biológicas",
        schoolYearCode: 2026,
      }),
    ).toBe("Biología - 4to EMS - Ciencias Biológicas (2026)");
  });
});
