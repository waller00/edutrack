import { moodleRest } from "./client.js";

/**
 * Ventana temporal opcional de una inscripción (suplencias). Acepta `Date` o epoch en ms;
 * se convierte a segundos Unix, que es lo que espera `enrol_manual_enrol_users`.
 */
export type EnrolWindow = {
  timestart?: Date | number | null;
  timeend?: Date | number | null;
};

function toUnixSeconds(v: Date | number | null | undefined): number | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : v;
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Inscribe (o reafirma, es idempotente en Moodle) a un usuario en un curso con un rol.
 * Usa el plugin de matriculación manual (`enrol_manual_enrol_users`).
 *
 * Si se pasa una ventana (`timestart`/`timeend`), Moodle activa/expira el acceso por sí mismo;
 * la reconciliación además revoca explícitamente cuando hace falta (ver `reconcile.ts`).
 */
export async function enrolUser(
  moodleUserId: number,
  moodleCourseId: number,
  roleId: number,
  window?: EnrolWindow,
): Promise<void> {
  const params: Record<string, string> = {
    "enrolments[0][roleid]": String(roleId),
    "enrolments[0][userid]": String(moodleUserId),
    "enrolments[0][courseid]": String(moodleCourseId),
  };
  const timestart = toUnixSeconds(window?.timestart);
  const timeend = toUnixSeconds(window?.timeend);
  if (timestart != null) params["enrolments[0][timestart]"] = String(timestart);
  if (timeend != null) params["enrolments[0][timeend]"] = String(timeend);

  try {
    await moodleRest("enrol_manual_enrol_users", params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Moodle puede inscribir igual y fallar solo al mandar el mail de bienvenida.
    if (message.includes("Message was not sent")) {
      const enrolled = await getEnrolledUserIds(moodleCourseId);
      if (enrolled.has(moodleUserId)) return;
    }
    throw error;
  }
}

/**
 * Inscribe varias parejas usuario↔curso en UNA sola llamada (`enrol_manual_enrol_users` acepta un
 * array). Reduce drásticamente la cantidad de requests del reconcile. Es idempotente en Moodle.
 *
 * No replica el rescate de "Message was not sent" de `enrolUser`: si la llamada en lote falla, el
 * llamador (reconcile) reintenta uno por uno con `enrolUser`, que sí lo maneja.
 */
export async function enrolUsersBatch(
  enrolments: Array<{ moodleUserId: number; moodleCourseId: number; roleId: number; window?: EnrolWindow }>,
): Promise<void> {
  if (enrolments.length === 0) return;
  const params: Record<string, string> = {};
  enrolments.forEach((e, i) => {
    params[`enrolments[${i}][roleid]`] = String(e.roleId);
    params[`enrolments[${i}][userid]`] = String(e.moodleUserId);
    params[`enrolments[${i}][courseid]`] = String(e.moodleCourseId);
    const timestart = toUnixSeconds(e.window?.timestart);
    const timeend = toUnixSeconds(e.window?.timeend);
    if (timestart != null) params[`enrolments[${i}][timestart]`] = String(timestart);
    if (timeend != null) params[`enrolments[${i}][timeend]`] = String(timeend);
  });
  await moodleRest("enrol_manual_enrol_users", params);
}

/**
 * Quita la matrícula manual de un usuario en un curso (`enrol_manual_unenrol_users`).
 * Idempotente: si el usuario ya no está inscripto, Moodle no falla.
 */
export async function unenrolUser(moodleUserId: number, moodleCourseId: number): Promise<void> {
  await moodleRest("enrol_manual_unenrol_users", {
    "enrolments[0][userid]": String(moodleUserId),
    "enrolments[0][courseid]": String(moodleCourseId),
  });
}

/** Usuarios ya inscritos en un curso (para reconciliación / detección de drift). */
export async function getEnrolledUserIds(moodleCourseId: number): Promise<Set<number>> {
  const data = await moodleRest("core_enrol_get_enrolled_users", {
    courseid: String(moodleCourseId),
  });
  const ids = new Set<number>();
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === "object" && "id" in row) {
        const id = Number((row as { id: unknown }).id);
        if (Number.isFinite(id)) ids.add(id);
      }
    }
  }
  return ids;
}
