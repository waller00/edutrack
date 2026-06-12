import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  enabledMock,
  ensureCategoryMock,
  ensureCourseMock,
  ensureSubjectCourseMock,
  ensureStudentMock,
  enrolUserMock,
  unenrolUserMock,
  syncUserMock,
  upsertEnrolmentMapMock,
  listActiveEnrolmentsMock,
  markRevokedMock,
  prismaMock,
} = vi.hoisted(() => ({
  enabledMock: vi.fn(),
  ensureCategoryMock: vi.fn(),
  ensureCourseMock: vi.fn(),
  ensureSubjectCourseMock: vi.fn(),
  ensureStudentMock: vi.fn(),
  enrolUserMock: vi.fn(),
  unenrolUserMock: vi.fn(),
  syncUserMock: vi.fn(),
  upsertEnrolmentMapMock: vi.fn(),
  listActiveEnrolmentsMock: vi.fn(),
  markRevokedMock: vi.fn(),
  prismaMock: {
    courseOffering: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    substitution: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    subjectCourseAssignment: { findMany: vi.fn() },
    subject: { findMany: vi.fn() },
  },
}));

vi.mock("./client.js", () => ({
  isMoodleIntegrationEnabled: enabledMock,
  moodleStudentRoleId: () => 5,
  moodleTeacherRoleId: () => 3,
  moodleSubstituteTeacherRoleId: () => 9,
}));
vi.mock("./courses.js", () => ({
  ensureCategory: ensureCategoryMock,
  ensureCourse: ensureCourseMock,
  ensureSubjectCourse: ensureSubjectCourseMock,
  ensureStudentMoodleUser: ensureStudentMock,
}));
vi.mock("./enrolments.js", () => ({ enrolUser: enrolUserMock, unenrolUser: unenrolUserMock }));
vi.mock("./enrolment-map.js", () => ({
  upsertEnrolmentMap: upsertEnrolmentMapMock,
  listActiveEnrolments: listActiveEnrolmentsMock,
  markEnrolmentRevoked: markRevokedMock,
}));
vi.mock("./users.js", () => ({ syncMoodleUserById: syncUserMock }));
vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

import { reconcileMoodle } from "./reconcile.js";

const schoolYear = { id: "sy1", label: "Ciclo 2026", code: 2026 };
const offering = {
  id: "off1",
  courseId: "course1",
  course: { name: "4to EMS", code: "4EMS", level: "EMS" },
  schoolYear,
};

// Eventos de docente titular (forma del select de reconcile).
function teacherEvent(over: Record<string, unknown> = {}) {
  return {
    assignedUserId: "u1",
    schoolYearId: "sy1",
    courseOfferingId: "off1",
    subjectId: "mat",
    orientationId: null,
    courseOrientationId: null,
    courseOffering: offering,
    subject: { name: "Matemática" },
    orientation: null,
    courseOrientation: null,
    ...over,
  };
}

// Suplencias (forma del select de reconcile).
function substitution(over: Record<string, unknown> = {}) {
  const evOver = (over.event as Record<string, unknown>) ?? {};
  delete over.event;
  return {
    id: "sub-1",
    substituteUserId: "sub1",
    startTime: new Date("2026-06-01T10:00:00.000Z"),
    endTime: new Date("2026-06-01T12:00:00.000Z"),
    event: {
      schoolYearId: "sy1",
      courseOfferingId: "off1",
      subjectId: "mat",
      orientationId: null,
      courseOrientationId: null,
      courseOffering: offering,
      subject: { name: "Matemática" },
      orientation: null,
      courseOrientation: null,
      ...evOver,
    },
    ...over,
  };
}

// ensureSubjectCourse devuelve un id estable por idnumber (cursos separados por scope).
let nextCourseId = 100;
const subjectCourseIds = new Map<string, number>();
function courseIdFor(idnumber: string): number {
  if (!subjectCourseIds.has(idnumber)) subjectCourseIds.set(idnumber, nextCourseId++);
  return subjectCourseIds.get(idnumber)!;
}

const moodleUserByEduId: Record<string, number> = { u1: 500, u2: 600, sub1: 700, sub2: 800 };

beforeEach(() => {
  enabledMock.mockReset().mockReturnValue(true);
  ensureCategoryMock.mockReset().mockResolvedValue(10);
  ensureCourseMock.mockReset().mockResolvedValue(999);
  ensureStudentMock.mockReset().mockResolvedValue(7000);
  enrolUserMock.mockReset().mockResolvedValue(undefined);
  unenrolUserMock.mockReset().mockResolvedValue(undefined);
  syncUserMock.mockReset().mockResolvedValue(null);
  upsertEnrolmentMapMock.mockReset().mockResolvedValue(undefined);
  listActiveEnrolmentsMock.mockReset().mockResolvedValue([]);
  markRevokedMock.mockReset().mockResolvedValue(undefined);

  nextCourseId = 100;
  subjectCourseIds.clear();
  ensureSubjectCourseMock
    .mockReset()
    .mockImplementation((args: { idnumber: string }) => Promise.resolve(courseIdFor(args.idnumber)));

  prismaMock.courseOffering.findMany.mockReset().mockResolvedValue([]);
  prismaMock.event.findMany.mockReset().mockResolvedValue([]);
  prismaMock.substitution.findMany.mockReset().mockResolvedValue([]);
  prismaMock.studentEnrollment.findMany.mockReset().mockResolvedValue([]);
  prismaMock.subjectCourseAssignment.findMany.mockReset().mockResolvedValue([]);
  prismaMock.subject.findMany.mockReset().mockResolvedValue([]);
  prismaMock.user.findUnique.mockReset().mockImplementation((args: { where: { id: string } }) =>
    Promise.resolve({ moodleUserId: moodleUserByEduId[args.where.id] ?? null }),
  );
});

describe("reconcileMoodle: estructura por asignatura/orientación", () => {
  it("devuelve resumen deshabilitado sin tocar la base si la integración está off", async () => {
    enabledMock.mockReturnValue(false);
    const summary = await reconcileMoodle();
    expect(summary.enabled).toBe(false);
    expect(prismaMock.event.findMany).not.toHaveBeenCalled();
  });

  it("crea un curso Moodle por asignatura general", async () => {
    prismaMock.event.findMany.mockResolvedValue([teacherEvent()]);
    const summary = await reconcileMoodle();
    expect(ensureSubjectCourseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idnumber: "et-subject-offering-off1-mat",
        fullname: "Matemática - 4to EMS (2026)",
      }),
    );
    expect(summary.courses).toBe(1);
    expect(summary.teacherEnrolments).toBe(1);
  });

  it("crea un curso Moodle por asignatura con orientationId", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      teacherEvent({ orientationId: "ori1", orientation: { name: "Científico" } }),
    ]);
    await reconcileMoodle();
    expect(ensureSubjectCourseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idnumber: "et-subject-offering-off1-mat-orientation-ori1",
        fullname: "Matemática - 4to EMS - Científico (2026)",
      }),
    );
  });

  it("crea un curso Moodle por asignatura con courseOrientationId", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      teacherEvent({
        courseOrientationId: "co1",
        courseOrientation: { orientation: { name: "Ciencias Biológicas" } },
        subjectId: "bio",
        subject: { name: "Biología" },
      }),
    ]);
    await reconcileMoodle();
    expect(ensureSubjectCourseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idnumber: "et-subject-offering-off1-bio-corientation-co1",
        fullname: "Biología - 4to EMS - Ciencias Biológicas (2026)",
      }),
    );
  });

  it("fallback legacy por CourseOffering para eventos sin subjectId", async () => {
    prismaMock.event.findMany.mockResolvedValue([teacherEvent({ subjectId: null, subject: null })]);
    const summary = await reconcileMoodle();
    expect(ensureCourseMock).toHaveBeenCalledWith(
      "off1",
      "et-offering-off1",
      expect.any(String),
      expect.any(String),
      10,
    );
    expect(ensureSubjectCourseMock).not.toHaveBeenCalled();
    expect(enrolUserMock).toHaveBeenCalledWith(500, 999, 3);
    expect(summary.teacherEnrolments).toBe(1);
  });
});

describe("reconcileMoodle: docentes titulares", () => {
  it("inscribe al titular sólo en el curso de su asignatura, no en otras", async () => {
    prismaMock.event.findMany.mockResolvedValue([
      teacherEvent({ subjectId: "mat", subject: { name: "Matemática" } }),
      teacherEvent({
        assignedUserId: "u2",
        subjectId: "lit",
        subject: { name: "Literatura" },
      }),
    ]);
    await reconcileMoodle();
    const matId = courseIdFor("et-subject-offering-off1-mat");
    const litId = courseIdFor("et-subject-offering-off1-lit");
    expect(matId).not.toBe(litId);
    expect(enrolUserMock).toHaveBeenCalledWith(500, matId, 3);
    expect(enrolUserMock).toHaveBeenCalledWith(600, litId, 3);
    // u1 no entra al curso de Literatura ni u2 al de Matemática.
    expect(enrolUserMock).not.toHaveBeenCalledWith(500, litId, 3);
    expect(enrolUserMock).not.toHaveBeenCalledWith(600, matId, 3);
  });

  it("no duplica la inscripción si hay varios eventos de la misma asignatura/curso", async () => {
    prismaMock.event.findMany.mockResolvedValue([teacherEvent(), teacherEvent({ id: "ev2" })]);
    const summary = await reconcileMoodle();
    expect(enrolUserMock).toHaveBeenCalledTimes(1);
    expect(summary.teacherEnrolments).toBe(1);
    expect(summary.courses).toBe(1);
  });

  it("sincroniza el usuario del docente si aún no tiene moodleUserId", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ moodleUserId: null });
    syncUserMock.mockResolvedValue(555);
    prismaMock.event.findMany.mockResolvedValue([teacherEvent()]);
    await reconcileMoodle();
    expect(syncUserMock).toHaveBeenCalledWith("u1");
    expect(enrolUserMock).toHaveBeenCalledWith(555, courseIdFor("et-subject-offering-off1-mat"), 3);
  });
});

describe("reconcileMoodle: suplencias", () => {
  it("inscribe al suplente en el curso correcto con ventana temporal y rol suplente", async () => {
    prismaMock.substitution.findMany.mockResolvedValue([substitution()]);
    const summary = await reconcileMoodle();
    const courseId = courseIdFor("et-subject-offering-off1-mat");
    expect(enrolUserMock).toHaveBeenCalledWith(700, courseId, 9, {
      timestart: new Date("2026-06-01T10:00:00.000Z"),
      timeend: new Date("2026-06-01T12:00:00.000Z"),
    });
    expect(upsertEnrolmentMapMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "SUBSTITUTE", moodleCourseId: courseId }),
    );
    expect(summary.substituteEnrolments).toBe(1);
  });

  it("con varias clases cubiertas, el acceso dura hasta el fin del último evento", async () => {
    prismaMock.substitution.findMany.mockResolvedValue([
      substitution({
        id: "s1",
        startTime: new Date("2026-06-01T10:00:00.000Z"),
        endTime: new Date("2026-06-01T12:00:00.000Z"),
      }),
      substitution({
        id: "s2",
        startTime: new Date("2026-06-08T08:00:00.000Z"),
        endTime: new Date("2026-06-08T14:00:00.000Z"),
      }),
    ]);
    await reconcileMoodle();
    const courseId = courseIdFor("et-subject-offering-off1-mat");
    // Una sola inscripción agrupada: del primer inicio al último fin.
    expect(enrolUserMock).toHaveBeenCalledTimes(1);
    expect(enrolUserMock).toHaveBeenCalledWith(700, courseId, 9, {
      timestart: new Date("2026-06-01T10:00:00.000Z"),
      timeend: new Date("2026-06-08T14:00:00.000Z"),
    });
  });
});

describe("reconcileMoodle: revocación de suplentes", () => {
  const courseId = 100; // primer id asignado por courseIdFor en cada test.
  const expiredSubMap = {
    id: "map-sub-1",
    userId: "sub1",
    moodleUserId: 700,
    moodleCourseId: courseId,
    roleId: 9,
    sourceType: "SUBSTITUTE" as const,
    sourceId: null,
    startsAt: null,
    endsAt: new Date("2026-05-01T12:00:00.000Z"),
  };

  it("revoca el acceso de una suplencia vencida (ya no aparece como activa)", async () => {
    // Sin suplencias vigentes; el mapa tiene una activa vencida.
    listActiveEnrolmentsMock.mockResolvedValue([expiredSubMap]);
    const summary = await reconcileMoodle();
    expect(unenrolUserMock).toHaveBeenCalledWith(700, courseId);
    expect(markRevokedMock).toHaveBeenCalledWith("map-sub-1");
    expect(summary.substituteRevocations).toBe(1);
  });

  it("NO revoca el acceso si el usuario también es titular del mismo curso", async () => {
    // sub1 es a la vez titular del curso de Matemática por un evento vigente.
    prismaMock.event.findMany.mockResolvedValue([teacherEvent({ assignedUserId: "sub1" })]);
    prismaMock.user.findUnique.mockResolvedValue({ moodleUserId: 700 });
    listActiveEnrolmentsMock.mockResolvedValue([expiredSubMap]);
    const summary = await reconcileMoodle();
    expect(unenrolUserMock).not.toHaveBeenCalled();
    // Se marca la fila de suplencia como revocada, pero el acceso titular permanece.
    expect(markRevokedMock).toHaveBeenCalledWith("map-sub-1");
    expect(summary.substituteRevocations).toBe(1);
  });

  it("NO revoca si el suplente tiene otra suplencia vigente/futura en el mismo curso", async () => {
    prismaMock.substitution.findMany.mockResolvedValue([substitution()]); // vigente
    listActiveEnrolmentsMock.mockResolvedValue([expiredSubMap]);
    const summary = await reconcileMoodle();
    expect(unenrolUserMock).not.toHaveBeenCalled();
    expect(markRevokedMock).not.toHaveBeenCalled();
    expect(summary.substituteRevocations).toBe(0);
    expect(summary.substituteEnrolments).toBe(1);
  });

  it("al cambiar el suplente, revoca al anterior e inscribe al nuevo", async () => {
    // Suplencia vigente del NUEVO suplente (sub2); el mapa activo es del ANTERIOR (sub1).
    prismaMock.substitution.findMany.mockResolvedValue([
      substitution({ substituteUserId: "sub2" }),
    ]);
    listActiveEnrolmentsMock.mockResolvedValue([expiredSubMap]);
    const summary = await reconcileMoodle();
    const matId = courseIdFor("et-subject-offering-off1-mat");
    expect(enrolUserMock).toHaveBeenCalledWith(800, matId, 9, expect.any(Object));
    expect(unenrolUserMock).toHaveBeenCalledWith(700, matId);
    expect(markRevokedMock).toHaveBeenCalledWith("map-sub-1");
    expect(summary.substituteEnrolments).toBe(1);
    expect(summary.substituteRevocations).toBe(1);
  });
});

describe("reconcileMoodle: resiliencia y estudiantes", () => {
  it("cuenta errores sin abortar cuando falla la creación de un curso", async () => {
    prismaMock.event.findMany.mockResolvedValue([teacherEvent()]);
    ensureSubjectCourseMock.mockRejectedValue(new Error("MOODLE_HTTP_500"));
    const summary = await reconcileMoodle();
    expect(summary.errors).toBe(1);
    expect(summary.teacherEnrolments).toBe(0);
  });

  it("con syncStudents inscribe estudiantes en asignaturas comunes y de su orientación", async () => {
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      {
        id: "en1",
        orientationId: "ori1",
        courseOrientationId: "co1",
        orientation: { name: "Científico" },
        courseOrientation: { orientation: { name: "Científico" } },
        courseOffering: offering,
        student: { id: "s1", firstName: "Ana", lastName: "Díaz", email: null, username: null },
      },
    ]);
    prismaMock.subjectCourseAssignment.findMany.mockResolvedValue([
      {
        subjectId: "mat",
        orientationId: null,
        schoolYearId: null,
        subject: { id: "mat", name: "Matemática" },
      },
      {
        subjectId: "bio",
        orientationId: "ori1",
        schoolYearId: "sy1",
        subject: { id: "bio", name: "Biología" },
      },
    ]);
    const summary = await reconcileMoodle({ syncStudents: true });
    expect(ensureSubjectCourseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idnumber: "et-subject-offering-off1-mat",
        fullname: "Matemática - 4to EMS (2026)",
      }),
    );
    expect(ensureSubjectCourseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idnumber: "et-subject-offering-off1-bio-corientation-co1",
        fullname: "Biología - 4to EMS - Científico (2026)",
      }),
    );
    expect(ensureCourseMock).not.toHaveBeenCalled();
    expect(enrolUserMock).toHaveBeenCalledWith(7000, courseIdFor("et-subject-offering-off1-mat"), 5);
    expect(enrolUserMock).toHaveBeenCalledWith(7000, courseIdFor("et-subject-offering-off1-bio-corientation-co1"), 5);
    expect(upsertEnrolmentMapMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "STUDENT_ENROLLMENT", sourceId: "en1" }),
    );
    expect(summary.studentEnrolments).toBe(2);
  });

  it("con syncStudents revoca asignaturas que ya no corresponden al estudiante", async () => {
    listActiveEnrolmentsMock.mockResolvedValue([
      {
        id: "map-old",
        userId: "s1",
        moodleUserId: 7000,
        moodleCourseId: 1234,
        roleId: 5,
        sourceType: "STUDENT_ENROLLMENT",
        sourceId: "en-old",
        startsAt: null,
        endsAt: null,
      },
    ]);
    const summary = await reconcileMoodle({ syncStudents: true });
    expect(unenrolUserMock).toHaveBeenCalledWith(7000, 1234);
    expect(markRevokedMock).toHaveBeenCalledWith("map-old");
    expect(summary.errors).toBe(0);
  });
});
