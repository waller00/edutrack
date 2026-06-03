/**
 * Facade de compatibilidad de la integración Moodle.
 *
 * La implementación vive en `src/integrations/moodle/`. Este módulo conserva la API que ya
 * usan las rutas (`ensureMoodleUserById`) pero su semántica cambió: en lugar de llamar a
 * Moodle "a ciegas" y perder los fallos, **encola** un upsert persistente (outbox) que el
 * worker reintenta con backoff. Así un fallo transitorio de Moodle no desincroniza en silencio.
 */
import { enqueueUserUpsert, isMoodleIntegrationEnabled } from "../integrations/moodle/index.js";

export { isMoodleIntegrationEnabled };
export type { MoodleSyncUserInput } from "../integrations/moodle/index.js";

/**
 * Encola la sincronización del usuario con Moodle (no bloquea ni lanza).
 * Mantiene la firma usada por las rutas (`void ensureMoodleUserById(id)`).
 */
export async function ensureMoodleUserById(userId: string): Promise<void> {
  await enqueueUserUpsert(userId);
}
