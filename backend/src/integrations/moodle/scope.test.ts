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
