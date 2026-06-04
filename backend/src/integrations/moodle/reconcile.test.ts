import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  enabledMock,
  ensureCategoryMock,
  ensureCourseMock,
  ensureStudentMock,
  enrolUserMock,
  syncUserMock,
  prismaMock,
} = vi.hoisted(() => ({
  enabledMock: vi.fn(),
  ensureCategoryMock: vi.fn(),
  ensureCourseMock: vi.fn(),
  ensureStudentMock: vi.fn(),
  enrolUserMock: vi.fn(),
  syncUserMock: vi.fn(),
  prismaMock: {
    courseOffering: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
  },
}));

vi.mock("./client.js", () => ({
  isMoodleIntegrationEnabled: enabledMock,
  moodleStudentRoleId: () => 5,
  moodleTeacherRoleId: () => 3,
}));
vi.mock("./courses.js", () => ({
  ensureCategory: ensureCategoryMock,
  ensureCourse: ensureCourseMock,
  ensureStudentMoodleUser: ensureStudentMock,
}));
vi.mock("./enrolments.js", () => ({ enrolUser: enrolUserMock }));
vi.mock("./users.js", () => ({ syncMoodleUserById: syncUserMock }));
vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

import { reconcileMoodle } from "./reconcile.js";

const offering = {
  id: "off1",
  course: { name: "Matemática", code: "MAT" },
  schoolYear: { id: "sy1", label: "Ciclo 2026", code: 2026 },
};

beforeEach(() => {
  enabledMock.mockReset().mockReturnValue(true);
  ensureCategoryMock.mockReset().mockResolvedValue(10);
  ensureCourseMock.mockReset().mockResolvedValue(100);
  ensureStudentMock.mockReset().mockResolvedValue(700);
  enrolUserMock.mockReset().mockResolvedValue(undefined);
  syncUserMock.mockReset().mockResolvedValue(500);
  prismaMock.courseOffering.findMany.mockReset().mockResolvedValue([]);
  prismaMock.event.findMany.mockReset().mockResolvedValue([]);
  prismaMock.user.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.studentEnrollment.findMany.mockReset().mockResolvedValue([]);
});

describe("reconcileMoodle", () => {
  it("devuelve resumen deshabilitado sin tocar la base si la integración está off", async () => {
    enabledMock.mockReturnValue(false);
    const summary = await reconcileMoodle();
    expect(summary).toEqual({
      enabled: false,
      courses: 0,
      teacherEnrolments: 0,
      studentEnrolments: 0,
      errors: 0,
    });
    expect(prismaMock.courseOffering.findMany).not.toHaveBeenCalled();
  });

  it("crea cursos e inscribe docentes según las clases asignadas", async () => {
    prismaMock.courseOffering.findMany.mockResolvedValue([offering]);
    prismaMock.event.findMany.mockResolvedValue([
      { assignedUserId: "u1", courseOfferingId: "off1" },
    ]);
    prismaMock.user.findUnique.mockResolvedValue({ moodleUserId: 500 });

    const summary = await reconcileMoodle();

    expect(summary.enabled).toBe(true);
    expect(summary.courses).toBe(1);
    expect(summary.teacherEnrolments).toBe(1);
    expect(enrolUserMock).toHaveBeenCalledWith(500, 100, 3);
    // No tenía moodleUserId nulo, así que no hace falta sincronizarlo.
    expect(syncUserMock).not.toHaveBeenCalled();
  });

  it("sincroniza el usuario del docente si aún no tiene moodleUserId", async () => {
    prismaMock.courseOffering.findMany.mockResolvedValue([offering]);
    prismaMock.event.findMany.mockResolvedValue([
      { assignedUserId: "u1", courseOfferingId: "off1" },
    ]);
    prismaMock.user.findUnique.mockResolvedValue({ moodleUserId: null });

    await reconcileMoodle();

    expect(syncUserMock).toHaveBeenCalledWith("u1");
    expect(enrolUserMock).toHaveBeenCalledWith(500, 100, 3);
  });

  it("con syncStudents inscribe estudiantes de matrícula activa", async () => {
    prismaMock.courseOffering.findMany.mockResolvedValue([offering]);
    prismaMock.studentEnrollment.findMany.mockResolvedValue([
      {
        courseOfferingId: "off1",
        student: { id: "s1", firstName: "Ana", lastName: "Díaz", contactEmail: null },
      },
    ]);

    const summary = await reconcileMoodle({ syncStudents: true });

    expect(summary.studentEnrolments).toBe(1);
    expect(ensureStudentMock).toHaveBeenCalled();
    expect(enrolUserMock).toHaveBeenCalledWith(700, 100, 5);
  });

  it("cuenta errores sin abortar cuando falla la creación de un curso", async () => {
    prismaMock.courseOffering.findMany.mockResolvedValue([offering]);
    ensureCourseMock.mockRejectedValue(new Error("MOODLE_HTTP_500"));

    const summary = await reconcileMoodle();

    expect(summary.errors).toBe(1);
    expect(summary.courses).toBe(0);
  });
});
