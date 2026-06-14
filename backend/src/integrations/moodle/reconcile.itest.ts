import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../../db/prisma.js";

/**
 * Regresión del bug de matrícula de estudiantes: `listStudentSubjectTargets` usaba
 * `schoolYearId: { in: [schoolYearId, null] }`, que Prisma rechaza → toda matrícula de
 * alumno fallaba en runtime (los mocks de la suite unit no lo veían).
 *
 * Acá corremos el reconcile REAL contra Postgres real, mockeando solo el I/O de Moodle
 * (HTTP). Si la query vuelve a romperse, este test falla.
 */

const { ensureSubjectCourseMock } = vi.hoisted(() => {
  const map = new Map<string, number>();
  let next = 1000;
  return {
    ensureSubjectCourseMock: vi.fn(async (args: { idnumber: string }) => {
      if (!map.has(args.idnumber)) map.set(args.idnumber, ++next);
      return map.get(args.idnumber)!;
    }),
  };
});

vi.mock("./client.js", () => ({
  isMoodleIntegrationEnabled: () => true,
  moodleStudentRoleId: () => 5,
  moodleTeacherRoleId: () => 3,
  moodleSubstituteTeacherRoleId: () => 3,
}));
vi.mock("./courses.js", () => ({
  ensureCategory: vi.fn(async () => 1),
  ensureCourse: vi.fn(async () => 2),
  ensureSubjectCourse: ensureSubjectCourseMock,
  ensureStudentMoodleUser: vi.fn(async () => 100),
}));
vi.mock("./enrolments.js", () => ({
  enrolUser: vi.fn(async () => undefined),
  unenrolUser: vi.fn(async () => undefined),
}));
vi.mock("./users.js", () => ({
  syncMoodleUserById: vi.fn(async () => 50),
}));

// Import dinámico DESPUÉS de declarar los mocks.
const { reconcileMoodle } = await import("./reconcile.js");

let studentId = "";

beforeAll(async () => {
  const sy = await prisma.schoolYear.create({ data: { code: 2026, label: "2026" } });
  const course = await prisma.course.create({ data: { name: "Primero A (it)" } });
  const offering = await prisma.courseOffering.create({
    data: { courseId: course.id, schoolYearId: sy.id },
  });

  const mate = await prisma.subject.create({ data: { name: "Matemática (it)" } });
  const bio = await prisma.subject.create({ data: { name: "Biología (it)" } });
  for (const subjectId of [mate.id, bio.id]) {
    await prisma.subjectCourseAssignment.create({
      data: {
        subjectId,
        courseId: course.id,
        schoolYearId: sy.id,
        associationType: "CURSO_COMPLETO",
      },
    });
  }

  const student = await prisma.student.create({
    data: { firstName: "Ana", lastName: "Itest", email: "ana.itest@example.com", username: `ana_it_${Date.now()}` },
  });
  studentId = student.id;
  await prisma.studentEnrollment.create({
    data: {
      studentId: student.id,
      schoolYearId: sy.id,
      courseOfferingId: offering.id,
      enrollmentStatus: "ACTIVE",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("integración: reconcileMoodle estudiantes", () => {
  it("matricula al alumno en cada asignatura común (sin el bug de in:[x,null])", async () => {
    const summary = await reconcileMoodle({ syncStudents: true });

    expect(summary.errors).toBe(0);
    expect(summary.studentEnrolments).toBe(2);

    const maps = await prisma.moodleEnrolmentMap.count({
      where: { userId: studentId, sourceType: "STUDENT_ENROLLMENT", status: "ACTIVE" },
    });
    expect(maps).toBe(2);
  });
});
