import { prisma } from "../../db/prisma.js";
import {
  isMoodleIntegrationEnabled,
  moodleStudentRoleId,
  moodleSubstituteTeacherRoleId,
  moodleTeacherRoleId,
} from "./client.js";
import {
  ensureCategory,
  ensureCourse,
  ensureStudentMoodleUser,
  ensureSubjectCourse,
} from "./courses.js";
import {
  listActiveEnrolments,
  markEnrolmentRevoked,
  upsertEnrolmentMap,
} from "./enrolment-map.js";
import { enrolUser, unenrolUser } from "./enrolments.js";
import { buildSubjectCourseFullname, resolveMoodleAcademicScope } from "./scope.js";
import { syncMoodleUserById } from "./users.js";

/**
 * Reconciliación completa EduTrack→Moodle.
 *
 * Construye el estado deseado desde la BD local (la fuente de verdad) y lo aplica de forma
 * idempotente. El acceso docente se deriva de los eventos académicos:
 *
 *  - Categoría por `SchoolYear`.
 *  - Un curso Moodle por **asignatura** dentro de curso(oferta)/año + orientación opcional
 *    (`courseOrientationId` con precedencia sobre `orientationId`). Eventos sin orientación van
 *    al espacio general de la asignatura; eventos con orientación a su espacio específico.
 *  - Docente **titular**: inscrito en el curso de la asignatura/orientación de cada clase asignada
 *    (`Event.assignedUserId` + `courseOfferingId` + `subjectId`). Fallback legacy por
 *    `CourseOffering` sólo para eventos sin `subjectId`.
 *  - Docente **suplente**: acceso temporal (`timestart`/`timeend`) al curso de la clase cubierta,
 *    con ventana hasta el fin del último evento de esa suplencia. Se revoca al vencer o al cambiar.
 *  - Estudiantes (opcional, legacy): se mantienen sobre el curso por `CourseOffering`.
 *
 * Toda inscripción otorgada queda registrada en `MoodleEnrolmentMap` para revocar de forma
 * segura sin depender únicamente del estado remoto de Moodle.
 */

export type ReconcileSummary = {
  enabled: boolean;
  courses: number;
  teacherEnrolments: number;
  substituteEnrolments: number;
  substituteRevocations: number;
  studentEnrolments: number;
  errors: number;
};

type SchoolYearLite = { id: string; label: string | null; code: number };
type OfferingLite = {
  id: string;
  course: { name: string; code: string | null };
  schoolYear: SchoolYearLite;
};

export async function reconcileMoodle(
  opts: { syncStudents?: boolean; now?: Date } = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    enabled: false,
    courses: 0,
    teacherEnrolments: 0,
    substituteEnrolments: 0,
    substituteRevocations: 0,
    studentEnrolments: 0,
    errors: 0,
  };
  if (!isMoodleIntegrationEnabled()) return summary;
  summary.enabled = true;

  const now = opts.now ?? new Date();
  const teacherRole = moodleTeacherRoleId();
  const studentRole = moodleStudentRoleId();
  const substituteRole = moodleSubstituteTeacherRoleId();

  // Caches por corrida (idempotencia + menos llamadas a Moodle).
  const categoryCache = new Map<string, number>();
  const courseByKey = new Map<string, number>();
  const moodleUserCache = new Map<string, number | null>();

  async function ensureCategoryFor(sy: SchoolYearLite): Promise<number> {
    const cached = categoryCache.get(sy.id);
    if (cached != null) return cached;
    const id = await ensureCategory(sy.id, `et-year-${sy.id}`, sy.label || `Ciclo ${sy.code}`);
    categoryCache.set(sy.id, id);
    return id;
  }

  async function ensureLegacyOfferingCourse(off: OfferingLite): Promise<number> {
    const key = `offering:${off.id}`;
    const cached = courseByKey.get(key);
    if (cached != null) return cached;
    const categoryId = await ensureCategoryFor(off.schoolYear);
    const fullname = `${off.course.name} (${off.schoolYear.code})`;
    const shortname = off.course.code
      ? `${off.course.code}-${off.schoolYear.code}`
      : `et-off-${off.id.slice(0, 12)}`;
    const id = await ensureCourse(off.id, `et-offering-${off.id}`, fullname, shortname, categoryId);
    courseByKey.set(key, id);
    summary.courses += 1;
    return id;
  }

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

  // ---- 1) Docentes titulares: clases asignadas → curso por asignatura/orientación. ----
  const teacherEvents = await prisma.event.findMany({
    where: { assignedUserId: { not: null }, courseOfferingId: { not: null } },
    select: {
      assignedUserId: true,
      schoolYearId: true,
      courseOfferingId: true,
      subjectId: true,
      orientationId: true,
      courseOrientationId: true,
      courseOffering: {
        select: {
          id: true,
          course: { select: { name: true, code: true } },
          schoolYear: { select: { id: true, label: true, code: true } },
        },
      },
      subject: { select: { name: true } },
      orientation: { select: { name: true } },
      courseOrientation: { select: { orientation: { select: { name: true } } } },
    },
  });

  // `${userId}::${moodleCourseId}` para no repetir trabajo y para la guarda de revocación.
  const teacherUserCourseKeys = new Set<string>();
  const processedTeacher = new Set<string>();

  for (const ev of teacherEvents) {
    const off = ev.courseOffering;
    if (!off) continue;
    try {
      const scope = resolveMoodleAcademicScope({
        schoolYearId: ev.schoolYearId,
        courseOfferingId: ev.courseOfferingId,
        subjectId: ev.subjectId,
        orientationId: ev.orientationId,
        courseOrientationId: ev.courseOrientationId,
      });

      let courseId: number;
      if (scope) {
        const existing = courseByKey.get(scope.key);
        if (existing != null) {
          courseId = existing;
        } else {
          const categoryId = await ensureCategoryFor(off.schoolYear);
          const orientationName = scope.isGeneral
            ? null
            : (ev.courseOrientation?.orientation?.name ?? ev.orientation?.name ?? null);
          const fullname = buildSubjectCourseFullname({
            subjectName: ev.subject?.name ?? "Asignatura",
            courseName: off.course.name,
            orientationName,
            schoolYearCode: off.schoolYear.code,
          });
          courseId = await ensureSubjectCourse({
            idnumber: scope.idnumber,
            fullname,
            shortname: scope.idnumber,
            categoryId,
          });
          courseByKey.set(scope.key, courseId);
          summary.courses += 1;
        }
      } else {
        // Fallback legacy documentado: evento sin asignatura → curso del CourseOffering completo.
        courseId = await ensureLegacyOfferingCourse(off);
      }

      const moodleUserId = await resolveMoodleUserId(ev.assignedUserId!);
      if (moodleUserId == null) continue;

      teacherUserCourseKeys.add(`${ev.assignedUserId}::${courseId}`);
      const dedupe = `${ev.assignedUserId}::${courseId}`;
      if (processedTeacher.has(dedupe)) continue;
      processedTeacher.add(dedupe);

      await enrolUser(moodleUserId, courseId, teacherRole);
      await upsertEnrolmentMap({
        userId: ev.assignedUserId!,
        moodleUserId,
        moodleCourseId: courseId,
        roleId: teacherRole,
        sourceType: "TEACHER_EVENT",
      });
      summary.teacherEnrolments += 1;
    } catch (e) {
      summary.errors += 1;
      console.error(
        "[moodle] reconcile titular falló:",
        ev.assignedUserId,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // ---- 2) Docentes suplentes: acceso temporal al curso de la clase cubierta. ----
  // Agrupa por (suplente, curso): la ventana va del primer al último evento cubierto vigente.
  type SubGroup = { userId: string; moodleUserId: number; courseId: number; start: Date; end: Date };
  const subGroups = new Map<string, SubGroup>();
  const subDesiredKeys = new Set<string>(); // `${userId}::${moodleCourseId}`

  const substitutions = await prisma.substitution.findMany({
    where: { endTime: { gte: now } },
    select: {
      id: true,
      substituteUserId: true,
      startTime: true,
      endTime: true,
      event: {
        select: {
          schoolYearId: true,
          courseOfferingId: true,
          subjectId: true,
          orientationId: true,
          courseOrientationId: true,
          courseOffering: {
            select: {
              id: true,
              course: { select: { name: true, code: true } },
              schoolYear: { select: { id: true, label: true, code: true } },
            },
          },
          subject: { select: { name: true } },
          orientation: { select: { name: true } },
          courseOrientation: { select: { orientation: { select: { name: true } } } },
        },
      },
    },
  });

  for (const sub of substitutions) {
    const ev = sub.event;
    const off = ev?.courseOffering;
    if (!ev || !off) continue;
    try {
      const scope = resolveMoodleAcademicScope({
        schoolYearId: ev.schoolYearId,
        courseOfferingId: ev.courseOfferingId,
        subjectId: ev.subjectId,
        orientationId: ev.orientationId,
        courseOrientationId: ev.courseOrientationId,
      });
      if (!scope) continue; // las suplencias siempre tienen asignatura; guarda defensiva.

      let courseId = courseByKey.get(scope.key);
      if (courseId == null) {
        const categoryId = await ensureCategoryFor(off.schoolYear);
        const orientationName = scope.isGeneral
          ? null
          : (ev.courseOrientation?.orientation?.name ?? ev.orientation?.name ?? null);
        const fullname = buildSubjectCourseFullname({
          subjectName: ev.subject?.name ?? "Asignatura",
          courseName: off.course.name,
          orientationName,
          schoolYearCode: off.schoolYear.code,
        });
        courseId = await ensureSubjectCourse({
          idnumber: scope.idnumber,
          fullname,
          shortname: scope.idnumber,
          categoryId,
        });
        courseByKey.set(scope.key, courseId);
        summary.courses += 1;
      }

      const moodleUserId = await resolveMoodleUserId(sub.substituteUserId);
      if (moodleUserId == null) continue;

      const gkey = `${sub.substituteUserId}::${courseId}`;
      subDesiredKeys.add(gkey);
      const group = subGroups.get(gkey);
      if (!group) {
        subGroups.set(gkey, {
          userId: sub.substituteUserId,
          moodleUserId,
          courseId,
          start: sub.startTime,
          end: sub.endTime,
        });
      } else {
        if (sub.startTime < group.start) group.start = sub.startTime;
        if (sub.endTime > group.end) group.end = sub.endTime;
      }
    } catch (e) {
      summary.errors += 1;
      console.error(
        "[moodle] reconcile suplencia falló:",
        sub.id,
        e instanceof Error ? e.message : e,
      );
    }
  }

  for (const g of subGroups.values()) {
    try {
      await enrolUser(g.moodleUserId, g.courseId, substituteRole, {
        timestart: g.start,
        timeend: g.end,
      });
      await upsertEnrolmentMap({
        userId: g.userId,
        moodleUserId: g.moodleUserId,
        moodleCourseId: g.courseId,
        roleId: substituteRole,
        sourceType: "SUBSTITUTE",
        startsAt: g.start,
        endsAt: g.end,
      });
      summary.substituteEnrolments += 1;
    } catch (e) {
      summary.errors += 1;
      console.error(
        "[moodle] reconcile inscripción suplente falló:",
        g.userId,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // ---- 3) Revocación de suplentes vencidos/cambiados (idempotente y segura). ----
  const activeSubMaps = await listActiveEnrolments("SUBSTITUTE");
  for (const m of activeSubMaps) {
    const key = `${m.userId}::${m.moodleCourseId}`;
    if (subDesiredKeys.has(key)) continue; // sigue vigente: ya se re-inscribió arriba.
    try {
      // No quitar el acceso si además es titular del mismo curso por un evento vigente.
      const isTitular = teacherUserCourseKeys.has(key);
      if (!isTitular) {
        await unenrolUser(m.moodleUserId, m.moodleCourseId);
      }
      await markEnrolmentRevoked(m.id);
      summary.substituteRevocations += 1;
    } catch (e) {
      summary.errors += 1;
      console.error(
        "[moodle] reconcile revocación suplente falló:",
        m.userId,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // ---- 4) Estudiantes (opcional, legacy por CourseOffering). ----
  // Prioridad de esta iteración: docentes y suplencias. El modelo por asignatura/orientación
  // para estudiantes queda como fase posterior (ver docs/MOODLE_INTEGRACION.md).
  if (opts.syncStudents) {
    const enrolments = await prisma.studentEnrollment.findMany({
      where: { enrollmentStatus: "ACTIVE" },
      select: {
        courseOffering: {
          select: {
            id: true,
            course: { select: { name: true, code: true } },
            schoolYear: { select: { id: true, label: true, code: true } },
          },
        },
        student: {
          select: { id: true, firstName: true, lastName: true, contactEmail: true },
        },
      },
    });
    for (const en of enrolments) {
      if (!en.courseOffering) continue;
      try {
        const courseId = await ensureLegacyOfferingCourse(en.courseOffering);
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
