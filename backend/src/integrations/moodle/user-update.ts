import { moodleRest } from "./client.js";

/**
 * `core_user_update_users` que falla de verdad cuando Moodle no aplica el cambio.
 *
 * Esa función no lanza excepción al rechazar un usuario: atrapa el error de cada uno y lo devuelve
 * como *warning* con HTTP 200 (p. ej. `useremailduplicate` si el email ya es de otra cuenta).
 * Leerlo como éxito perdía el cambio sin rastro y dejaba la tarea del outbox en DONE.
 */
export async function updateMoodleUsers(params: Record<string, string>): Promise<void> {
  const result = await moodleRest("core_user_update_users", params);
  const warnings = Array.isArray(result) ? [] : result.warnings;
  if (!Array.isArray(warnings) || warnings.length === 0) return;

  const detail = warnings
    .map((w) => {
      const o = (w ?? {}) as Record<string, unknown>;
      return `[${String(o.warningcode ?? "?")}] ${String(o.message ?? "")}`.trim();
    })
    .join("; ");
  throw new Error(`MOODLE_USER_UPDATE_REJECTED: ${detail}`);
}
