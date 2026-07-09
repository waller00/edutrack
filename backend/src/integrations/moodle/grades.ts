import { moodleRest } from "./client.js";

/**
 * Capa de calificaciones Moodle (tareas / `mod_assign`).
 *
 * EduTrack no almacena notas: sólo lee las tareas de un curso, sus notas actuales y escribe
 * las notas de vuelta. Es la base del "puente de notas" (planilla offline). Sólo conoce el
 * protocolo WS; la resolución del curso/estudiante Moodle vive en las capas superiores.
 */

/** Tipo de calificación derivado del campo `grade` de la tarea Moodle. */
export type AssignmentGradeType = "point" | "scale" | "none";

export type MoodleAssignment = {
  /** Id de instancia de la tarea (`assignmentid` para las demás WS). */
  id: number;
  /** Id del módulo de curso (para armar links a la tarea). */
  cmid: number | null;
  name: string;
  /** Nota máxima cuando `gradeType === "point"`; `null` en escala/sin nota. */
  maxGrade: number | null;
  gradeType: AssignmentGradeType;
};

function numericField(row: unknown, key: string): number | null {
  if (row && typeof row === "object" && key in row) {
    const v = Number((row as Record<string, unknown>)[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function stringField(row: unknown, key: string): string {
  if (row && typeof row === "object" && key in row) {
    const v = (row as Record<string, unknown>)[key];
    return v == null ? "" : String(v);
  }
  return "";
}

/**
 * En Moodle el campo `grade` de una tarea codifica el tipo: `>0` = puntaje (nota máxima),
 * `<0` = escala (id negativo), `0` = sin calificación.
 */
function gradeTypeFromRaw(raw: number | null): { gradeType: AssignmentGradeType; maxGrade: number | null } {
  if (raw == null || raw === 0) return { gradeType: "none", maxGrade: null };
  if (raw < 0) return { gradeType: "scale", maxGrade: null };
  return { gradeType: "point", maxGrade: raw };
}

/** Lista las tareas de un curso Moodle (`mod_assign_get_assignments`). */
export async function listCourseAssignments(moodleCourseId: number): Promise<MoodleAssignment[]> {
  const data = await moodleRest("mod_assign_get_assignments", {
    "courseids[0]": String(moodleCourseId),
  });
  const courses =
    data && typeof data === "object" && "courses" in data
      ? (data as { courses?: unknown }).courses
      : null;
  if (!Array.isArray(courses)) return [];

  const out: MoodleAssignment[] = [];
  for (const course of courses) {
    const assignments =
      course && typeof course === "object" && "assignments" in course
        ? (course as { assignments?: unknown }).assignments
        : null;
    if (!Array.isArray(assignments)) continue;
    for (const a of assignments) {
      const id = numericField(a, "id");
      if (id == null) continue;
      const { gradeType, maxGrade } = gradeTypeFromRaw(numericField(a, "grade"));
      out.push({
        id,
        cmid: numericField(a, "cmid"),
        name: stringField(a, "name"),
        maxGrade,
        gradeType,
      });
    }
  }
  return out;
}

/**
 * Notas actuales de una tarea (`mod_assign_get_grades`), indexadas por `moodleUserId`.
 * Moodle usa `-1` para "sin calificar": esos casos se omiten del mapa.
 *
 * Una tarea puede tener varias entradas por alumno (reintentos/re-calificaciones) y el orden del
 * array no garantiza la vigente: nos quedamos con la de mayor `timemodified` (o `attemptnumber`).
 */
/** Acumula en `best` la nota vigente (mayor timemodified/attempt) de cada alumno de una tarea. */
function accumulateLatestGrades(rawGrades: unknown, best: Map<number, { grade: number; ts: number }>): void {
  if (!Array.isArray(rawGrades)) return;
  for (const g of rawGrades) {
    const userId = numericField(g, "userid");
    const grade = numericField(g, "grade");
    if (userId == null || grade == null || grade < 0) continue;
    const ts = numericField(g, "timemodified") ?? numericField(g, "attemptnumber") ?? 0;
    const prev = best.get(userId);
    if (!prev || ts >= prev.ts) best.set(userId, { grade, ts });
  }
}

export async function getAssignmentGrades(assignmentId: number): Promise<Map<number, number>> {
  const data = await moodleRest("mod_assign_get_grades", {
    "assignmentids[0]": String(assignmentId),
  });
  const assignments =
    data && typeof data === "object" && "assignments" in data
      ? (data as { assignments?: unknown }).assignments
      : null;
  const best = new Map<number, { grade: number; ts: number }>();
  if (!Array.isArray(assignments)) return new Map();

  for (const a of assignments) {
    const grades = a && typeof a === "object" && "grades" in a ? (a as { grades?: unknown }).grades : null;
    accumulateLatestGrades(grades, best);
  }

  const result = new Map<number, number>();
  for (const [userId, v] of best) result.set(userId, v.grade);
  return result;
}

/**
 * Escribe la nota de un alumno en una tarea (`mod_assign_save_grade`). Idempotente: sobrescribe
 * la nota existente. `attemptnumber=-1` apunta al último intento.
 *
 * `applytoall=0` (calificación INDIVIDUAL): la planilla es por-alumno, así que en tareas de
 * entrega grupal NO se debe propagar la nota al resto del grupo (con `=1` cada grupo quedaría con
 * la nota del último integrante procesado). Devuelve `void`; ante error, `moodleRest` lanza `MOODLE_EXCEPTION`.
 */
export async function saveAssignmentGrade(
  assignmentId: number,
  moodleUserId: number,
  grade: number,
): Promise<void> {
  await moodleRest("mod_assign_save_grade", {
    assignmentid: String(assignmentId),
    userid: String(moodleUserId),
    grade: String(grade),
    attemptnumber: "-1",
    addattempt: "0",
    workflowstate: "",
    applytoall: "0",
  });
}
