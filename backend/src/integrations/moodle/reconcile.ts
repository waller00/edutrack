import { prisma } from "../../db/prisma.js";
import {
  isMoodleIntegrationEnabled,
  moodleStudentRoleId,
  moodleTeacherRoleId,
} from "./client.js";
import { ensureCategory, ensureCourse, ensureStudentMoodleUser } from "./courses.js";
import { enrolUser } from "./enrolments.js";
import { syncMoodleUserById } from "./users.js";

/**
 * Reconciliación completa EduTrack→Moodle.
 *
 * Construye el estado deseado desde la BD local (la fuente de verdad) y lo aplica de forma
 * idempotente: categorías por ciclo, cursos por oferta (`CourseOffering`), profesores
 * inscritos según las clases asignadas (`Event.assignedUserId`) y, opcionalmente, estudiantes
 * según su matrícula activa (`StudentEnrollment`). Repara drift (objetos borrados/desmapeados).
 */

export type ReconcileSummary = {
  enabled: boolean;
  courses: number;
  teacherEnrolments: number;
  studentEnrolments: number;
  errors: number;
};

export async function reconcileMoodle(
  opts: { syncStudents?: boolean } = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    enabled: false,
    courses: 0,
    teacherEnrolments: 0,
    studentEnrolments: 0,
    errors: 0,
  };
  if (!isMoodleIntegrationEnabled()) return summary;
  summary.enabled = true;

  const teacherRole = moodleTeacherRoleId();
  const studentRole = moodleStudentRoleId();

  // 1) Ofertas vigentes → cursos de Moodle (categoría = ciclo lectivo).
  const offeringToCourse = new Map<string, number>();
  const offerings = await prisma.courseOffering.findMany({
    where: { isActive: true, isOffered: true },
    select: {
      id: true,
      course: { select: { name: true, code: true } },
      schoolYear: { select: { id: true, label: true, code: true } },
    },
  });

  for (const off of offerings) {
    try {
      const categoryId = await ensureCategory(
        off.schoolYear.id,
        `et-year-${off.schoolYear.id}`,
        off.schoolYear.label || `Ciclo ${off.schoolYear.code}`,
      );
      const fullname = `${off.course.name} (${off.schoolYear.code})`;
      const shortname = off.course.code
        ? `${off.course.code}-${off.schoolYear.code}`
        : `et-off-${off.id.slice(0, 12)}`;
      const courseId = await ensureCourse(
        off.id,
        `et-offering-${off.id}`,
        fullname,
        shortname,
        categoryId,
      );
      offeringToCourse.set(off.id, courseId);
      summary.courses += 1;
    } catch (e) {
      summary.errors += 1;
      console.error("[moodle] reconcile curso falló:", off.id, e instanceof Error ? e.message : e);
    }
  }

  // 2) Inscripción de profesores: clases asignadas (Event.assignedUserId + courseOfferingId).
  const teacherLinks = await prisma.event.findMany({
    where: { assignedUserId: { not: null }, courseOfferingId: { not: null } },
    select: { assignedUserId: true, courseOfferingId: true },
    distinct: ["assignedUserId", "courseOfferingId"],
  });

  const moodleUserCache = new Map<string, number | null>();
  async function resolveMoodleUserId(userId: string): Promise<number | null> {
    if (moodleUserCache.has(userId)) return moodleUserCache.get(userId)!;
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { moodleUserId: true },
    });
    let id = u?.moodleUserId ?? null;
    if (id == null) id = await syncMoodleUserById(userId);
    moodleUserCache.set(userId, id);
    return id;
  }

  for (const link of teacherLinks) {
    const courseId = offeringToCourse.get(link.courseOfferingId!);
    if (courseId == null) continue;
    try {
      const moodleUserId = await resolveMoodleUserId(link.assignedUserId!);
      if (moodleUserId == null) continue;
      await enrolUser(moodleUserId, courseId, teacherRole);
      summary.teacherEnrolments += 1;
    } catch (e) {
      summary.errors += 1;
      console.error(
        "[moodle] reconcile inscripción docente falló:",
        link.assignedUserId,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 3) Inscripción de estudiantes (opcional): matrícula activa.
  if (opts.syncStudents) {
    const enrolments = await prisma.studentEnrollment.findMany({
      where: { enrollmentStatus: "ACTIVE" },
      select: {
        courseOfferingId: true,
        student: {
          select: { id: true, firstName: true, lastName: true, contactEmail: true },
        },
      },
    });
    for (const en of enrolments) {
      const courseId = offeringToCourse.get(en.courseOfferingId);
      if (courseId == null) continue;
      try {
        const moodleUserId = await ensureStudentMoodleUser({
          id: en.student.id,
          firstName: en.student.firstName,
          lastName: en.student.lastName,
          email: en.student.contactEmail,
        });
        await enrolUser(moodleUserId, courseId, studentRole);
        summary.studentEnrolments += 1;
      } catch (e) {
        summary.errors += 1;
        console.error(
          "[moodle] reconcile inscripción estudiante falló:",
          en.student.id,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  return summary;
}
