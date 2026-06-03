import { moodleRest } from "./client.js";

/**
 * Inscribe (o reafirma, es idempotente en Moodle) a un usuario en un curso con un rol.
 * Usa el plugin de matriculación manual (`enrol_manual_enrol_users`).
 */
export async function enrolUser(
  moodleUserId: number,
  moodleCourseId: number,
  roleId: number,
): Promise<void> {
  await moodleRest("enrol_manual_enrol_users", {
    "enrolments[0][roleid]": String(roleId),
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
