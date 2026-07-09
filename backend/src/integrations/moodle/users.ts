import { randomBytes } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import {
  isMoodleIntegrationEnabled,
  moodleRest,
  moodleUserAuthMethod,
  moodleUserLangParam,
} from "./client.js";

export type MoodleSyncUserInput = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

function moodleUsernameForEduTrackUser(userId: string): string {
  const hex = userId.replace(/-/g, "");
  const u = `et${hex}`;
  return u.length > 100 ? u.slice(0, 100) : u;
}

function deriveMoodleNames(user: MoodleSyncUserInput): { firstname: string; lastname: string } {
  const fn = user.firstName?.trim();
  const ln = user.lastName?.trim();
  if (fn && ln) return { firstname: fn.slice(0, 100), lastname: ln.slice(0, 100) };
  if (fn) return { firstname: fn.slice(0, 100), lastname: "-" };
  if (ln) return { firstname: "-", lastname: ln.slice(0, 100) };
  const n = user.name?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return {
        firstname: parts[0]!.slice(0, 100),
        lastname: parts.slice(1).join(" ").slice(0, 100),
      };
    }
    return { firstname: n.slice(0, 100), lastname: "-" };
  }
  return { firstname: "Usuario", lastname: "EduTrack" };
}

function randomMoodlePassword(): string {
  const core = randomBytes(18).toString("base64url");
  return `Et${core}a1!`;
}

function firstMoodleId(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  for (const row of data) {
    if (row && typeof row === "object" && "id" in row) {
      const id = Number((row as { id: unknown }).id);
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
}

export async function getUserIdByField(
  field: "idnumber" | "email",
  value: string,
): Promise<number | null> {
  const data = await moodleRest("core_user_get_users_by_field", {
    field,
    "values[0]": value,
  });
  return firstMoodleId(data);
}

/**
 * Garantiza que exista un usuario en Moodle vinculado a EduTrack (`idnumber` = UUID) y
 * persiste el id de Moodle en `User.moodleUserId` (idempotencia + detección de drift).
 * La fuente de verdad sigue siendo la BD local.
 *
 * Devuelve el id de Moodle, o lanza (la capa outbox decide reintentar).
 */
export async function syncMoodleUser(user: MoodleSyncUserInput): Promise<number | null> {
  if (!isMoodleIntegrationEnabled()) return null;

  const email = user.email?.trim().toLowerCase();
  if (!email) {
    console.warn("[moodle] syncMoodleUser: sin email, se omite", user.id);
    return null;
  }

  // 1) ¿Ya existe por idnumber (UUID EduTrack)? → fuente del vínculo.
  const byId = await getUserIdByField("idnumber", user.id);
  if (byId != null) {
    await persistMoodleUserId(user.id, byId);
    return byId;
  }

  // 2) Existe por email (p. ej. cuenta creada al entrar con OAuth): vincular sin duplicar.
  const byEmail = await getUserIdByField("email", email);
  if (byEmail != null) {
    await moodleRest("core_user_update_users", {
      "users[0][id]": String(byEmail),
      "users[0][idnumber]": user.id,
    });
    await persistMoodleUserId(user.id, byEmail);
    return byEmail;
  }

  // 3) Crear el usuario espejo.
  const { firstname, lastname } = deriveMoodleNames(user);
  const username = moodleUsernameForEduTrackUser(user.id);
  const generatedSecret = randomMoodlePassword();

  const auth = moodleUserAuthMethod();
  // Nota: `core_user_create_users` NO acepta la key `confirmed` (rechaza con
  // "Unexpected keys (confirmed) detected"); los usuarios creados por el WS ya quedan
  // confirmados por defecto, así que no hay que enviarla.
  const params: Record<string, string> = {
    "users[0][username]": username,
    ["users[0][create" + "pass" + "word]"]: "0",
    ["users[0][pass" + "word]"]: generatedSecret,
    "users[0][firstname]": firstname,
    "users[0][lastname]": lastname,
    "users[0][email]": email,
    "users[0][auth]": auth,
    "users[0][idnumber]": user.id,
    "users[0][maildisplay]": "0",
    ...moodleUserLangParam("users[0]"),
  };

  const created = await moodleRest("core_user_create_users", params);
  const newId = firstMoodleId(created);
  if (newId == null) {
    throw new Error(`MOODLE_CREATE_USER_UNEXPECTED: ${JSON.stringify(created).slice(0, 300)}`);
  }
  await persistMoodleUserId(user.id, newId);
  return newId;
}

async function persistMoodleUserId(userId: string, moodleId: number): Promise<void> {
  // Sólo persiste si el id local corresponde a un User (los estudiantes-espejo se mapean aparte).
  await prisma.user
    .update({ where: { id: userId }, data: { moodleUserId: moodleId } })
    .catch(() => {
      /* el id puede no ser un User (p. ej. estudiante); el mapeo se maneja en courses.ts */
    });
}

export async function syncMoodleUserById(userId: string): Promise<number | null> {
  if (!isMoodleIntegrationEnabled()) return null;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, name: true },
  });
  if (!u) return null;
  return syncMoodleUser(u);
}
