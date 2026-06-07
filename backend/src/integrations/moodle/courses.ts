import type { MoodleObjectType } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { moodleRest, moodleRootCategoryId } from "./client.js";

/**
 * Capa de estructura académica: categorías y cursos de Moodle, con mapeo persistente
 * (`MoodleObjectMap`) para idempotencia. Cada objeto de Moodle lleva un `idnumber`
 * canónico derivado del id de EduTrack, de modo que el vínculo sobrevive a recreaciones.
 */

function numericField(row: unknown, key: string): number | null {
  if (row && typeof row === "object" && key in row) {
    const v = Number((row as Record<string, unknown>)[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

async function getMappedId(objectType: MoodleObjectType, localId: string): Promise<number | null> {
  const row = await prisma.moodleObjectMap.findUnique({
    where: { objectType_localId: { objectType, localId } },
    select: { moodleId: true },
  });
  return row?.moodleId ?? null;
}

async function saveMapping(
  objectType: MoodleObjectType,
  localId: string,
  moodleId: number,
  idnumber: string,
): Promise<void> {
  await prisma.moodleObjectMap.upsert({
    where: { objectType_localId: { objectType, localId } },
    create: { objectType, localId, moodleId, idnumber },
    update: { moodleId, idnumber },
  });
}

/** Categoría = entidad de catálogo (curso/orientación) o ciclo lectivo. */
export async function ensureCategory(
  localId: string,
  idnumber: string,
  name: string,
): Promise<number> {
  const mapped = await getMappedId("CATEGORY", localId);
  if (mapped != null) return mapped;

  // ¿Existe ya en Moodle por idnumber? (recuperación de drift / mapeo perdido)
  const found = await moodleRest("core_course_get_categories", {
    "criteria[0][key]": "idnumber",
    "criteria[0][value]": idnumber,
  });
  if (Array.isArray(found) && found.length > 0) {
    const id = numericField(found[0], "id");
    if (id != null) {
      await saveMapping("CATEGORY", localId, id, idnumber);
      return id;
    }
  }

  const created = await moodleRest("core_course_create_categories", {
    "categories[0][name]": name.slice(0, 255),
    "categories[0][idnumber]": idnumber,
    "categories[0][parent]": String(moodleRootCategoryId()),
  });
  const id = Array.isArray(created) ? numericField(created[0], "id") : null;
  if (id == null) {
    throw new Error(`MOODLE_CREATE_CATEGORY_UNEXPECTED: ${JSON.stringify(created).slice(0, 300)}`);
  }
  await saveMapping("CATEGORY", localId, id, idnumber);
  return id;
}

/**
 * Curso de Moodle = unidad enseñable de EduTrack. `objectType` distingue el curso legacy por
 * `CourseOffering` (`COURSE`) del curso por asignatura/orientación (`SUBJECT_COURSE`).
 */
export async function ensureCourse(
  localId: string,
  idnumber: string,
  fullname: string,
  shortname: string,
  categoryId: number,
  objectType: MoodleObjectType = "COURSE",
): Promise<number> {
  const mapped = await getMappedId(objectType, localId);
  if (mapped != null) return mapped;

  const found = await moodleRest("core_course_get_courses_by_field", {
    field: "idnumber",
    value: idnumber,
  });
  if (found && typeof found === "object" && "courses" in found) {
    const courses = (found as { courses?: unknown }).courses;
    if (Array.isArray(courses) && courses.length > 0) {
      const id = numericField(courses[0], "id");
      if (id != null) {
        await saveMapping(objectType, localId, id, idnumber);
        return id;
      }
    }
  }

  const created = await moodleRest("core_course_create_courses", {
    "courses[0][fullname]": fullname.slice(0, 254),
    "courses[0][shortname]": shortname.slice(0, 255),
    "courses[0][idnumber]": idnumber,
    "courses[0][categoryid]": String(categoryId),
  });
  const id = Array.isArray(created) ? numericField(created[0], "id") : null;
  if (id == null) {
    throw new Error(`MOODLE_CREATE_COURSE_UNEXPECTED: ${JSON.stringify(created).slice(0, 300)}`);
  }
  await saveMapping(objectType, localId, id, idnumber);
  return id;
}

/**
 * Curso de Moodle por asignatura (dentro de curso/año, con orientación opcional). El `idnumber`
 * canónico (estable e idempotente) se usa también como `localId` del mapeo y como `shortname`.
 */
export async function ensureSubjectCourse(args: {
  idnumber: string;
  fullname: string;
  shortname: string;
  categoryId: number;
}): Promise<number> {
  return ensureCourse(
    args.idnumber,
    args.idnumber,
    args.fullname,
    args.shortname,
    args.categoryId,
    "SUBJECT_COURSE",
  );
}

export type StudentMirrorInput = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
};

/**
 * Crea/recupera el usuario espejo de un estudiante (que en EduTrack no tiene cuenta de login).
 * Email sintético determinista si no hay contacto, para satisfacer la restricción de Moodle.
 */
export async function ensureStudentMoodleUser(student: StudentMirrorInput): Promise<number> {
  const mapped = await getMappedId("STUDENT", student.id);
  if (mapped != null) return mapped;

  const idnumber = `et-student-${student.id}`;
  const email =
    student.email?.trim().toLowerCase() ||
    `student-${student.id.replace(/-/g, "")}@students.edutrack.local`;

  const byId = await moodleRest("core_user_get_users_by_field", {
    field: "idnumber",
    "values[0]": idnumber,
  });
  if (Array.isArray(byId) && byId.length > 0) {
    const id = numericField(byId[0], "id");
    if (id != null) {
      await saveMapping("STUDENT", student.id, id, idnumber);
      return id;
    }
  }

  const username = `ets${student.id.replace(/-/g, "")}`.slice(0, 100);
  const created = await moodleRest("core_user_create_users", {
    "users[0][username]": username,
    ["users[0][create" + "pass" + "word]"]: "0",
    ["users[0][pass" + "word]"]: `EtS-${student.id.slice(0, 8)}-a1!`,
    "users[0][firstname]": (student.firstName || "Estudiante").slice(0, 100),
    "users[0][lastname]": (student.lastName || "-").slice(0, 100),
    "users[0][email]": email,
    "users[0][auth]": "nologin",
    "users[0][idnumber]": idnumber,
    "users[0][maildisplay]": "0",
  });
  const id = Array.isArray(created) ? numericField(created[0], "id") : null;
  if (id == null) {
    throw new Error(`MOODLE_CREATE_STUDENT_UNEXPECTED: ${JSON.stringify(created).slice(0, 300)}`);
  }
  await saveMapping("STUDENT", student.id, id, idnumber);
  return id;
}
