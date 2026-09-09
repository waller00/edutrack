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
import { enrolUser, enrolUsersBatch, unenrolUser } from "./enrolments.js";
import {
  buildSubjectCourseFullname,
  type MoodleSubjectScope,
  resolveMoodleAcademicScope,
} from "./scope.js";
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
  /** Alumnos salteados por no tener email + usuario: sin eso sólo se les podría crear un espejo `nologin`. */
  studentsWithoutAccount: number;
  errors: number;
};

let reconcileInFlight: Promise<ReconcileSummary> | null = null;

type SchoolYearLite = { id: string; label: string | null; code: number };
type OfferingLite = {
  id: string;
  course: { name: string; code: string | null };
  schoolYear: SchoolYearLite;
};
type SubjectCourseInfo = {
  subjectName: string;
  offering: OfferingLite;
  courseOrientationName: string | null;
  orientationName: string | null;
};
type StudentSubjectTarget = {
  subject: { id: string; name: string };
  orientationId: string | null;
  courseOrientationId: string | null;
  orientationName: string | null;
};

/** Estado mutable compartido por las fases de la reconciliación. */
type ReconcileContext = {
  summary: ReconcileSummary;
  now: Date;
  roles: { teacher: number; student: number; substitute: number };
  categoryCache: Map<string, number>;
  courseByKey: Map<string, number>;
  moodleUserCache: Map<string, number | null>;
};

function logError(stage: string, ref: unknown, e: unknown): void {
  const detail = e instanceof Error
    ? e.message || e.stack?.split("\n")[0] || e.name || "Error sin mensaje"
    : String(e);
  console.error(`[moodle] reconcile ${stage} falló:`, ref, detail);
}

async function ensureCategoryFor(ctx: ReconcileContext, sy: SchoolYearLite): Promise<number> {
  const cached = ctx.categoryCache.get(sy.id);
  if (cached != null) return cached;
  const id = await ensureCategory(sy.id, `et-year-${sy.id}`, sy.label || `Ciclo ${sy.code}`);
  ctx.categoryCache.set(sy.id, id);
  return id;
}

async function ensureLegacyOfferingCourse(
  ctx: ReconcileContext,
  off: OfferingLite,
): Promise<number> {
  const key = `offering:${off.id}`;
  const cached = ctx.courseByKey.get(key);
  if (cached != null) return cached;
  const categoryId = await ensureCategoryFor(ctx, off.schoolYear);
  const fullname = `${off.course.name} (${off.schoolYear.code})`;
  const shortname = off.course.code
    ? `${off.course.code}-${off.schoolYear.code}`
    : `et-off-${off.id.slice(0, 12)}`;
  const id = await ensureCourse(off.id, `et-offering-${off.id}`, fullname, shortname, categoryId);
  ctx.courseByKey.set(key, id);
  ctx.summary.courses += 1;
  return id;
}

/** Curso Moodle por asignatura/orientación (idempotente, cacheado por scope). */
async function ensureSubjectCourseFor(
  ctx: ReconcileContext,
  scope: MoodleSubjectScope,
  info: SubjectCourseInfo,
): Promise<number> {
  const cached = ctx.courseByKey.get(scope.key);
  if (cached != null) return cached;
  const categoryId = await ensureCategoryFor(ctx, info.offering.schoolYear);
  const orientationName = scope.isGeneral
    ? null
    : (info.courseOrientationName ?? info.orientationName ?? null);
  const fullname = buildSubjectCourseFullname({
    subjectName: info.subjectName,
    courseName: info.offering.course.name,
    orientationName,
    schoolYearCode: info.offering.schoolYear.code,
  });
  const id = await ensureSubjectCourse({
    idnumber: scope.idnumber,
    fullname,
    shortname: scope.idnumber,
    categoryId,
  });
  ctx.courseByKey.set(scope.key, id);
  ctx.summary.courses += 1;
  return id;
}

async function resolveMoodleUserId(ctx: ReconcileContext, userId: string): Promise<number | null> {
  if (ctx.moodleUserCache.has(userId)) return ctx.moodleUserCache.get(userId) ?? null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { moodleUserId: true },
  });
  const id = u?.moodleUserId ?? (await syncMoodleUserById(userId));
  ctx.moodleUserCache.set(userId, id);
  return id;
}

const academicEventSelect = {
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
} as const;

type AcademicEventLike = {
  schoolYearId: string;
  courseOfferingId: string | null;
  subjectId: string | null;
  orientationId: string | null;
  courseOrientationId: string | null;
  courseOffering: OfferingLite | null;
  subject: { name: string } | null;
  orientation: { name: string } | null;
  courseOrientation: { orientation: { name: string } | null } | null;
};

function scopeOf(ev: AcademicEventLike): MoodleSubjectScope | null {
  return resolveMoodleAcademicScope({
    schoolYearId: ev.schoolYearId,
    courseOfferingId: ev.courseOfferingId,
    subjectId: ev.subjectId,
    orientationId: ev.orientationId,
    courseOrientationId: ev.courseOrientationId,
  });
}

function subjectInfoOf(ev: AcademicEventLike, off: OfferingLite): SubjectCourseInfo {
  return {
    subjectName: ev.subject?.name ?? "Asignatura",
    offering: off,
    courseOrientationName: ev.courseOrientation?.orientation?.name ?? null,
    orientationName: ev.orientation?.name ?? null,
  };
}

function uniqueTargets(targets: StudentSubjectTarget[]): StudentSubjectTarget[] {
  const seen = new Set<string>();
  const out: StudentSubjectTarget[] = [];
  for (const target of targets) {
    const key = `${target.subject.id}:${target.courseOrientationId ?? target.orientationId ?? "general"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

async function listStudentSubjectTargets(en: {
  courseOffering: OfferingLite & { courseId: string; course: OfferingLite["course"] & { level?: string | null } };
  orientationId: string | null;
  courseOrientationId: string | null;
  orientation: { name: string } | null;
  courseOrientation: { orientation: { name: string } | null } | null;
}): Promise<StudentSubjectTarget[]> {
  const schoolYearId = en.courseOffering.schoolYear.id;
  const courseId = en.courseOffering.courseId;
  const level = en.courseOffering.course.level ?? null;
  const orientationId = en.orientationId;
  const orientationName = en.courseOrientation?.orientation?.name ?? en.orientation?.name ?? null;

  const assignmentScopes: Array<Record<string, string | null>> = [
    ...(level ? [{ level, courseId: null, orientationId: null }] : []),
    { courseId, orientationId: null },
    ...(orientationId ? [{ courseId, orientationId }] : []),
  ];

  const assignedSubjects = await prisma.subjectCourseAssignment.findMany({
    where: {
      isActive: true,
      isOffered: true,
      visibleInFilters: true,
      subject: { isActive: true },
      // Prisma rechaza `null` dentro de `in`; "del ciclo o sin ciclo" va como OR explícito.
      AND: [
        { OR: assignmentScopes },
        { OR: [{ schoolYearId }, { schoolYearId: null }] },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { subject: { sortOrder: "asc" } }, { subject: { name: "asc" } }],
    select: {
      subjectId: true,
      orientationId: true,
      schoolYearId: true,
      subject: { select: { id: true, name: true } },
    },
  });

  const bestAssignmentByScope = new Map<string, (typeof assignedSubjects)[number]>();
  for (const assignment of assignedSubjects) {
    const key = `${assignment.subjectId}:${assignment.orientationId ?? "general"}`;
    const current = bestAssignmentByScope.get(key);
    if (!current || (!current.schoolYearId && assignment.schoolYearId === schoolYearId)) {
      bestAssignmentByScope.set(key, assignment);
    }
  }

  const targets = Array.from(bestAssignmentByScope.values()).map((assignment) => {
    const appliesToStudentOrientation = orientationId && assignment.orientationId === orientationId;
    return {
      subject: assignment.subject,
      orientationId: appliesToStudentOrientation ? orientationId : null,
      courseOrientationId: appliesToStudentOrientation ? en.courseOrientationId : null,
      orientationName: appliesToStudentOrientation ? orientationName : null,
    };
  });

  const legacySubjects = await prisma.subject.findMany({
    where: {
      isActive: true,
      OR: [
        { courseId },
        { courseOfferingId: en.courseOffering.id },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  return uniqueTargets([
    ...targets,
    ...legacySubjects.map((subject) => ({
      subject,
      orientationId: null,
      courseOrientationId: null,
      orientationName: null,
    })),
  ]);
}

async function ensureStudentSubjectCourseFor(
  ctx: ReconcileContext,
  target: StudentSubjectTarget,
  offering: OfferingLite,
): Promise<number> {
  const scope = resolveMoodleAcademicScope({
    schoolYearId: offering.schoolYear.id,
    courseOfferingId: offering.id,
    subjectId: target.subject.id,
    orientationId: target.orientationId,
    courseOrientationId: target.courseOrientationId,
  });
  if (!scope) {
    return ensureLegacyOfferingCourse(ctx, offering);
  }
  return ensureSubjectCourseFor(ctx, scope, {
    subjectName: target.subject.name,
    offering,
    courseOrientationName: target.courseOrientationId ? target.orientationName : null,
    orientationName: target.orientationId ? target.orientationName : null,
  });
}

/** Fase 1 — docentes titulares. Devuelve las claves `userId::moodleCourseId` para la revocación. */
async function reconcileTeacherEnrolments(ctx: ReconcileContext): Promise<Set<string>> {
  const events = await prisma.event.findMany({
    where: { assignedUserId: { not: null }, courseOfferingId: { not: null } },
    select: { assignedUserId: true, ...academicEventSelect },
  });

  const teacherUserCourseKeys = new Set<string>();
  const processed = new Set<string>();

  for (const ev of events) {
    const off = ev.courseOffering;
    if (!off) continue;
    try {
      const scope = scopeOf(ev);
      const courseId = scope
        ? await ensureSubjectCourseFor(ctx, scope, subjectInfoOf(ev, off))
        : await ensureLegacyOfferingCourse(ctx, off); // fallback legacy: evento sin asignatura.

      const moodleUserId = await resolveMoodleUserId(ctx, ev.assignedUserId!);
      if (moodleUserId == null) continue;

      const dedupe = `${ev.assignedUserId}::${courseId}`;
      teacherUserCourseKeys.add(dedupe);
      if (processed.has(dedupe)) continue;
      processed.add(dedupe);

      await enrolUser(moodleUserId, courseId, ctx.roles.teacher);
      await upsertEnrolmentMap({
        userId: ev.assignedUserId!,
        moodleUserId,
        moodleCourseId: courseId,
        roleId: ctx.roles.teacher,
        sourceType: "TEACHER_EVENT",
      });
      ctx.summary.teacherEnrolments += 1;
    } catch (e) {
      ctx.summary.errors += 1;
      logError("titular", ev.assignedUserId, e);
    }
  }
  return teacherUserCourseKeys;
}

type SubGroup = { userId: string; moodleUserId: number; courseId: number; start: Date; end: Date };

/** Agrupa las suplencias vigentes por (suplente, curso) y resuelve el curso Moodle de cada una. */
async function collectSubstituteGroups(ctx: ReconcileContext): Promise<Map<string, SubGroup>> {
  const substitutions = await prisma.substitution.findMany({
    where: { endTime: { gte: ctx.now } },
    select: {
      id: true,
      substituteUserId: true,
      startTime: true,
      endTime: true,
      event: { select: academicEventSelect },
    },
  });

  const groups = new Map<string, SubGroup>();
  for (const sub of substitutions) {
    const ev = sub.event;
    const off = ev?.courseOffering;
    if (!ev || !off) continue;
    try {
      const scope = scopeOf(ev);
      if (!scope) continue; // las suplencias siempre tienen asignatura; guarda defensiva.
      const courseId = await ensureSubjectCourseFor(ctx, scope, subjectInfoOf(ev, off));
      const moodleUserId = await resolveMoodleUserId(ctx, sub.substituteUserId);
      if (moodleUserId == null) continue;

      const gkey = `${sub.substituteUserId}::${courseId}`;
      const group = groups.get(gkey);
      if (!group) {
        groups.set(gkey, {
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
      ctx.summary.errors += 1;
      logError("suplencia", sub.id, e);
    }
  }
  return groups;
}

/** Fase 2 — suplentes activos. Devuelve las claves `userId::moodleCourseId` aún vigentes. */
async function reconcileSubstituteEnrolments(ctx: ReconcileContext): Promise<Set<string>> {
  const groups = await collectSubstituteGroups(ctx);
  const desiredKeys = new Set<string>();
  for (const g of groups.values()) {
    desiredKeys.add(`${g.userId}::${g.courseId}`);
    try {
      await enrolUser(g.moodleUserId, g.courseId, ctx.roles.substitute, {
        timestart: g.start,
        timeend: g.end,
      });
      await upsertEnrolmentMap({
        userId: g.userId,
        moodleUserId: g.moodleUserId,
        moodleCourseId: g.courseId,
        roleId: ctx.roles.substitute,
        sourceType: "SUBSTITUTE",
        startsAt: g.start,
        endsAt: g.end,
      });
      ctx.summary.substituteEnrolments += 1;
    } catch (e) {
      ctx.summary.errors += 1;
      logError("inscripción suplente", g.userId, e);
    }
  }
  return desiredKeys;
}

/** Fase 3 — revoca suplentes vencidos/cambiados, sin tocar titularidad ni otra suplencia vigente. */
async function revokeStaleSubstitutes(
  ctx: ReconcileContext,
  teacherUserCourseKeys: Set<string>,
  substituteDesiredKeys: Set<string>,
): Promise<void> {
  const activeSubMaps = await listActiveEnrolments("SUBSTITUTE");
  for (const m of activeSubMaps) {
    const key = `${m.userId}::${m.moodleCourseId}`;
    if (substituteDesiredKeys.has(key)) continue; // sigue vigente: ya se re-inscribió arriba.
    try {
      // No quitar el acceso si además es titular del mismo curso por un evento vigente.
      if (!teacherUserCourseKeys.has(key)) {
        await unenrolUser(m.moodleUserId, m.moodleCourseId);
      }
      await markEnrolmentRevoked(m.id);
      ctx.summary.substituteRevocations += 1;
    } catch (e) {
      ctx.summary.errors += 1;
      logError("revocación suplente", m.userId, e);
    }
  }
}

/**
 * Inscribe al alumno en todas sus asignaturas. Intenta una sola llamada en lote; si falla, cae al
 * modo uno-por-uno (comportamiento previo, que además rescata el caso "Message was not sent").
 * Tras inscribir (por cualquiera de los dos caminos) registra el mapeo y suma al resumen.
 */
async function enrolStudentInCourses(
  ctx: ReconcileContext,
  en: { id: string; studentId: string },
  moodleUserId: number,
  courseIds: number[],
): Promise<void> {
  let batched = false;
  if (courseIds.length > 1) {
    try {
      await enrolUsersBatch(
        courseIds.map((moodleCourseId) => ({ moodleUserId, moodleCourseId, roleId: ctx.roles.student })),
      );
      batched = true;
    } catch (e) {
      logError("inscripción estudiante (lote → reintenta uno-por-uno)", en.studentId, e);
    }
  }

  for (const courseId of courseIds) {
    if (!batched) await enrolUser(moodleUserId, courseId, ctx.roles.student);
    await upsertEnrolmentMap({
      userId: en.studentId,
      moodleUserId,
      moodleCourseId: courseId,
      roleId: ctx.roles.student,
      sourceType: "STUDENT_ENROLLMENT",
      sourceId: en.id,
    });
    ctx.summary.studentEnrolments += 1;
  }
}

/** Fase 4 — estudiantes: asignaturas comunes + asignaturas de su orientación, con revocación. */
async function reconcileStudentEnrolments(ctx: ReconcileContext): Promise<void> {
  const enrolments = await prisma.studentEnrollment.findMany({
    where: { enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      orientationId: true,
      courseOrientationId: true,
      orientation: { select: { name: true } },
      courseOrientation: { select: { orientation: { select: { name: true } } } },
      courseOffering: {
        select: {
          id: true,
          courseId: true,
          course: { select: { name: true, code: true, level: true } },
          schoolYear: { select: { id: true, label: true, code: true } },
        },
      },
      student: { select: { id: true, firstName: true, lastName: true, email: true, username: true } },
    },
  });
  const desiredKeys = new Set<string>();
  // Alumnos cuyo procesamiento lanzó: no deben revocarse sus accesos por un fallo transitorio
  // (un hipo de Moodle no debe borrar inscripciones válidas, que arrastra notas/entregas).
  const failedStudentIds = new Set<string>();
  // Alumnos sin email o usuario. Con la misma lógica que los fallidos: se saltean SIN tocar sus
  // matrículas. `desiredKeys` se llena dentro del try, así que saltear sin registrarlo acá haría
  // que el bucle de revocación de más abajo los desmatriculara de todos sus cursos.
  const skippedStudentIds = new Set<string>();
  for (const en of enrolments) {
    if (!en.courseOffering) continue;
    // Sin email + usuario sólo se podría crear un espejo `nologin` con email sintético: cuentas
    // basura que nadie puede usar. La cuenta se crea desde el botón de la ficha del alumno.
    if (!en.student.email?.trim() || !en.student.username?.trim()) {
      skippedStudentIds.add(en.student.id);
      ctx.summary.studentsWithoutAccount += 1;
      continue;
    }
    try {
      const moodleUserId = await ensureStudentMoodleUser({
        id: en.student.id,
        firstName: en.student.firstName,
        lastName: en.student.lastName,
        email: en.student.email,
        username: en.student.username,
      });
      const targets = await listStudentSubjectTargets(en);
      const courseIds: number[] = [];
      for (const target of targets) {
        const courseId = await ensureStudentSubjectCourseFor(ctx, target, en.courseOffering);
        desiredKeys.add(`${en.student.id}::${courseId}`);
        courseIds.push(courseId);
      }
      await enrolStudentInCourses(ctx, { id: en.id, studentId: en.student.id }, moodleUserId, courseIds);
    } catch (e) {
      failedStudentIds.add(en.student.id);
      ctx.summary.errors += 1;
      logError("inscripción estudiante", en.student.id, e);
    }
  }

  const activeStudentMaps = await listActiveEnrolments("STUDENT_ENROLLMENT");
  for (const m of activeStudentMaps) {
    if (desiredKeys.has(`${m.userId}::${m.moodleCourseId}`)) continue;
    // El alumno falló este run, o se salteó por no tener cuenta: conservar su acceso hasta que se
    // pueda recalcular bien. Los egresados/transferidos ni aparecen en `enrolments`, así que sí se
    // revocan.
    if (failedStudentIds.has(m.userId) || skippedStudentIds.has(m.userId)) continue;
    try {
      await unenrolUser(m.moodleUserId, m.moodleCourseId);
      await markEnrolmentRevoked(m.id);
    } catch (e) {
      ctx.summary.errors += 1;
      logError("revocación estudiante", m.userId, e);
    }
  }
}

async function runReconcileMoodle(
  opts: { syncStudents?: boolean; now?: Date } = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    enabled: false,
    courses: 0,
    teacherEnrolments: 0,
    substituteEnrolments: 0,
    substituteRevocations: 0,
    studentEnrolments: 0,
    studentsWithoutAccount: 0,
    errors: 0,
  };
  if (!isMoodleIntegrationEnabled()) return summary;
  summary.enabled = true;

  const ctx: ReconcileContext = {
    summary,
    now: opts.now ?? new Date(),
    roles: {
      teacher: moodleTeacherRoleId(),
      student: moodleStudentRoleId(),
      substitute: moodleSubstituteTeacherRoleId(),
    },
    categoryCache: new Map(),
    courseByKey: new Map(),
    moodleUserCache: new Map(),
  };

  const teacherUserCourseKeys = await reconcileTeacherEnrolments(ctx);
  const substituteDesiredKeys = await reconcileSubstituteEnrolments(ctx);
  await revokeStaleSubstitutes(ctx, teacherUserCourseKeys, substituteDesiredKeys);

  if (opts.syncStudents) {
    await reconcileStudentEnrolments(ctx);
  }

  return summary;
}

export async function reconcileMoodle(
  opts: { syncStudents?: boolean; now?: Date } = {},
): Promise<ReconcileSummary> {
  if (reconcileInFlight) return reconcileInFlight;
  const run = runReconcileMoodle(opts);
  reconcileInFlight = run;
  try {
    return await run;
  } finally {
    if (reconcileInFlight === run) reconcileInFlight = null;
  }
}
