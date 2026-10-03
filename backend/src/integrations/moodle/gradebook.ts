import { moodleRest } from "./client.js";

/**
 * Libro de calificaciones de Moodle (`gradereport_user_get_grade_items`).
 *
 * A diferencia de `grades.ts`, que sólo ve tareas (`mod_assign`), esto devuelve **todos** los
 * ítems de calificación del curso —cuestionarios, foros, talleres, ítems manuales— con las notas
 * de todos los alumnos, en **una sola llamada**. El puente viejo hacía N llamadas, una por tarea,
 * y aun así no veía nada que no fuera una tarea.
 *
 * Requiere habilitar `gradereport_user_get_grade_items` en el external service del token.
 */

export type MoodleGradeItem = {
  /** Id del ítem de calificación en Moodle; identifica la evaluación al reimportar. */
  id: number;
  name: string;
  /** `mod` (actividad), `manual` (columna a mano), `category` o `course` (totales). */
  itemType: string;
  itemModule: string | null;
  gradeMin: number;
  gradeMax: number;
  hidden: boolean;
};

export type MoodleUserGrade = {
  moodleUserId: number;
  /** `idnumber` del usuario en Moodle; para estudiantes de EduTrack es `et-student-<uuid>`. */
  idnumber: string | null;
  itemId: number;
  /** Nota cruda en la escala del ítem; `null` si no está calificado. */
  raw: number | null;
};

export type CourseGradeReport = {
  items: MoodleGradeItem[];
  grades: MoodleUserGrade[];
};

/**
 * Número de un campo, o `null` si no hay dato.
 *
 * El chequeo explícito de `null`/`undefined`/`""` no es defensivo de más: `Number(null)` es `0` y
 * es finito, así que sin esto un alumno **sin calificar** importaría un cero — que en una libreta
 * es una nota real y de las peores.
 */
function num(row: unknown, key: string): number | null {
  if (!row || typeof row !== "object" || !(key in row)) return null;
  const raw = (row as Record<string, unknown>)[key];
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function str(row: unknown, key: string): string | null {
  if (row && typeof row === "object" && key in row) {
    const value = (row as Record<string, unknown>)[key];
    return value == null ? null : String(value);
  }
  return null;
}

/**
 * Ítems que pueden convertirse en una evaluación de la libreta.
 *
 * Se descartan los totales (`course` y `category`): no son actividades sino agregados que Moodle
 * calcula, y traerlos como evaluación duplicaría lo que la libreta ya promedia por su cuenta.
 * También se descartan los ítems ocultos y los que no puntúan (`gradeMax <= 0`).
 */
export function isImportableItem(item: MoodleGradeItem): boolean {
  if (item.itemType === "course" || item.itemType === "category") return false;
  if (item.hidden) return false;
  return item.gradeMax > 0;
}

function parseItem(row: unknown): MoodleGradeItem | null {
  const id = num(row, "id");
  if (id == null) return null;
  const gradeMin = num(row, "grademin") ?? 0;
  const gradeMax = num(row, "grademax") ?? 0;
  return {
    id,
    name: str(row, "itemname") ?? `Ítem ${id}`,
    itemType: str(row, "itemtype") ?? "",
    itemModule: str(row, "itemmodule"),
    gradeMin,
    gradeMax,
    // Moodle expone la visibilidad con dos banderas distintas según cómo se ocultó.
    hidden: Boolean((row as any)?.gradeishidden) || Boolean((row as any)?.gradehiddenbydate),
  };
}

/** Lee el libro de calificaciones completo de un curso. */
export async function fetchCourseGradeReport(moodleCourseId: number): Promise<CourseGradeReport> {
  const data = await moodleRest("gradereport_user_get_grade_items", {
    courseid: String(moodleCourseId),
    // `userid=0` pide el reporte de todos los matriculados en una sola llamada.
    userid: "0",
  });

  const userGrades =
    data && typeof data === "object" && "usergrades" in data
      ? (data as { usergrades?: unknown }).usergrades
      : null;
  if (!Array.isArray(userGrades)) return { items: [], grades: [] };

  const itemsById = new Map<number, MoodleGradeItem>();
  const grades: MoodleUserGrade[] = [];

  for (const userRow of userGrades) {
    const moodleUserId = num(userRow, "userid");
    if (moodleUserId == null) continue;
    const idnumber = str(userRow, "useridnumber");
    const gradeItems = (userRow as any)?.gradeitems;
    if (!Array.isArray(gradeItems)) continue;

    for (const itemRow of gradeItems) {
      const item = parseItem(itemRow);
      if (!item || !isImportableItem(item)) continue;
      if (!itemsById.has(item.id)) itemsById.set(item.id, item);
      grades.push({ moodleUserId, idnumber, itemId: item.id, raw: num(itemRow, "graderaw") });
    }
  }

  return { items: [...itemsById.values()], grades };
}
