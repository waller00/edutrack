import { randomBytes } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { isMoodleIntegrationEnabled, moodleRest, moodleUserLangParam } from "./client.js";
import { getMappedId, saveMapping } from "./object-map.js";
import { sendStudentWelcomeEmail } from "../../notifications/student-welcome.js";

/**
 * Cuentas Moodle de estudiantes.
 *
 * Con `username` + `email` el alumno recibe una cuenta real (auth manual) con la que
 * puede entrar a Moodle; al crearse por primera vez se le envía un mail de bienvenida
 * con el link para establecer su contraseña. Sin email se mantiene el espejo histórico
 * `nologin` (email sintético) para que la matriculación nunca dependa del dato de contacto.
 */

export type StudentAccountInput = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  username?: string | null;
};

export type MoodleStudentVerificationState = "VERIFIED" | "PENDING" | "NOT_FOUND" | "UNAVAILABLE";

export type MoodleStudentVerification = {
  state: MoodleStudentVerificationState;
  verified: boolean | null;
  accountExists: boolean;
  moodleUserId: number | null;
  firstAccessAt: string | null;
};

/** Clave estable e idempotente del alumno en Moodle (sobrevive a recreaciones de la cuenta). */
export function studentIdnumber(studentId: string): string {
  return `et-student-${studentId}`;
}

function numericField(row: unknown, key: string): number | null {
  if (row && typeof row === "object" && key in row) {
    const v = Number((row as Record<string, unknown>)[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function booleanField(row: unknown, key: string): boolean | null {
  if (!row || typeof row !== "object" || !(key in row)) return null;
  const value = (row as Record<string, unknown>)[key];
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function stringField(row: unknown, key: string): string | null {
  if (!row || typeof row !== "object" || !(key in row)) return null;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function hasForcedPasswordChange(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const preferences = (row as Record<string, unknown>).preferences;
  if (!Array.isArray(preferences)) return false;
  return preferences.some((preference) => {
    if (!preference || typeof preference !== "object") return false;
    const p = preference as Record<string, unknown>;
    return (p.name ?? p.type) === "auth_forcepasswordchange" && String(p.value) === "1";
  });
}

function unavailableVerification(): MoodleStudentVerification {
  return {
    state: "UNAVAILABLE",
    verified: null,
    accountExists: false,
    moodleUserId: null,
    firstAccessAt: null,
  };
}

/**
 * Consulta el estado remoto de varias cuentas en una sola llamada. Consideramos verificada la
 * cuenta cuando Moodle registra al menos un acceso y ya no exige cambiar la clave temporal.
 */
export async function getStudentMoodleVerifications(
  studentIds: string[],
): Promise<Map<string, MoodleStudentVerification>> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  const result = new Map<string, MoodleStudentVerification>();
  if (!isMoodleIntegrationEnabled()) {
    for (const id of ids) result.set(id, unavailableVerification());
    return result;
  }

  for (const id of ids) {
    result.set(id, {
      state: "NOT_FOUND",
      verified: false,
      accountExists: false,
      moodleUserId: null,
      firstAccessAt: null,
    });
  }
  if (ids.length === 0) return result;

  const params: Record<string, string> = { field: "idnumber" };
  ids.forEach((id, index) => {
    params[`values[${index}]`] = studentIdnumber(id);
  });
  const rows = await moodleRest("core_user_get_users_by_field", params);
  if (!Array.isArray(rows)) return result;

  for (const row of rows) {
    const idnumber = stringField(row, "idnumber");
    if (!idnumber?.startsWith("et-student-")) continue;
    const studentId = idnumber.slice("et-student-".length);
    if (!result.has(studentId)) continue;

    const moodleUserId = numericField(row, "id");
    const firstAccess = numericField(row, "firstaccess") ?? 0;
    const confirmed = booleanField(row, "confirmed");
    const verified = firstAccess > 0 && confirmed !== false && !hasForcedPasswordChange(row);
    result.set(studentId, {
      state: verified ? "VERIFIED" : "PENDING",
      verified,
      accountExists: moodleUserId != null,
      moodleUserId,
      firstAccessAt: firstAccess > 0 ? new Date(firstAccess * 1000).toISOString() : null,
    });
  }
  return result;
}

function randomStudentPassword(): string {
  return `Et${randomBytes(18).toString("base64url")}a1!`;
}

/**
 * Contraseña temporal legible para tipear una sola vez (cumple la política por defecto
 * de Moodle: mayúscula, minúscula, dígito y símbolo). El alumno la cambia en el primer login.
 */
function readableTempPassword(): string {
  const digits = (randomBytes(2).readUInt16BE(0) % 9000) + 1000; // 1000-9999
  const letters = randomBytes(3).toString("hex"); // 6 minúsculas/dígitos
  return `Edu-${letters}-${digits}!`;
}

/**
 * Fija la contraseña del alumno en Moodle. Con `forceChange` se le exige cambiarla en el primer
 * ingreso (camino de la bienvenida); sin eso queda usable tal cual, que es lo que necesitan los
 * datos de demo para poder mostrar el login de un alumno en vivo.
 */
export async function setStudentMoodlePassword(
  moodleId: number,
  password: string,
  opts: { forceChange?: boolean } = {},
): Promise<void> {
  await moodleRest("core_user_update_users", {
    "users[0][id]": String(moodleId),
    ["users[0][pass" + "word]"]: password,
    ...(opts.forceChange
      ? {
          "users[0][preferences][0][type]": "auth_forcepasswordchange",
          "users[0][preferences][0][value]": "1",
        }
      : {}),
  });
}

/** Fija una contraseña temporal y fuerza el cambio en el primer ingreso del alumno. */
async function setStudentTempPassword(moodleId: number, password: string): Promise<void> {
  await setStudentMoodlePassword(moodleId, password, { forceChange: true });
}

function realAccountData(s: StudentAccountInput): { username: string; email: string } | null {
  const username = s.username?.trim().toLowerCase();
  const email = s.email?.trim().toLowerCase();
  if (!username || !email) return null;
  return { username, email };
}

function moodleNames(s: StudentAccountInput): { firstname: string; lastname: string } {
  return {
    firstname: (s.firstName || "Estudiante").slice(0, 100),
    lastname: (s.lastName || "-").slice(0, 100),
  };
}

async function findStudentByIdnumber(idnumber: string): Promise<number | null> {
  const byId = await moodleRest("core_user_get_users_by_field", {
    field: "idnumber",
    "values[0]": idnumber,
  });
  return Array.isArray(byId) && byId.length > 0 ? numericField(byId[0], "id") : null;
}

/** Convierte un espejo `nologin` (o cuenta desactualizada) en cuenta real manual. */
async function upgradeStudentToManual(moodleId: number, s: StudentAccountInput): Promise<void> {
  const real = realAccountData(s);
  if (!real) return;
  const { firstname, lastname } = moodleNames(s);
  await moodleRest("core_user_update_users", {
    "users[0][id]": String(moodleId),
    "users[0][auth]": "manual",
    "users[0][username]": real.username,
    "users[0][email]": real.email,
    "users[0][firstname]": firstname,
    "users[0][lastname]": lastname,
    ...moodleUserLangParam("users[0]"),
  });
}

async function createStudentMoodleUser(s: StudentAccountInput, hasReal: boolean): Promise<number> {
  const idnumber = studentIdnumber(s.id);
  const real = realAccountData(s);
  const { firstname, lastname } = moodleNames(s);
  const username = real?.username ?? `ets${s.id.replace(/-/g, "")}`.slice(0, 100);
  const email = real?.email ?? `student-${s.id.replace(/-/g, "")}@students.edutrack.local`;
  const password = hasReal ? randomStudentPassword() : `EtS-${s.id.slice(0, 8)}-a1!`;

  const created = await moodleRest("core_user_create_users", {
    "users[0][username]": username,
    ["users[0][create" + "pass" + "word]"]: "0",
    ["users[0][pass" + "word]"]: password,
    "users[0][firstname]": firstname,
    "users[0][lastname]": lastname,
    "users[0][email]": email,
    "users[0][auth]": hasReal ? "manual" : "nologin",
    "users[0][idnumber]": idnumber,
    "users[0][maildisplay]": "0",
    ...moodleUserLangParam("users[0]"),
  });
  const id = Array.isArray(created) ? numericField(created[0], "id") : null;
  if (id == null) {
    throw new Error(`MOODLE_CREATE_STUDENT_UNEXPECTED: ${JSON.stringify(created).slice(0, 300)}`);
  }
  await saveMapping("STUDENT", s.id, id, idnumber);
  return id;
}

/**
 * Garantiza el usuario Moodle del estudiante (idempotente vía mapping + idnumber).
 * Con `forceUpdate` además alinea username/email/auth en Moodle con los datos locales
 * (camino del outbox cuando cambian datos de cuenta); la reconciliación periódica no
 * lo usa para no generar una llamada de update por alumno en cada pasada.
 */
export async function ensureStudentMoodleAccount(
  s: StudentAccountInput,
  opts: { forceUpdate?: boolean } = {},
): Promise<{ moodleId: number; realAccount: boolean }> {
  const hasReal = realAccountData(s) != null;

  const mapped = await getMappedId("STUDENT", s.id);
  if (mapped != null) {
    if (hasReal && opts.forceUpdate) await upgradeStudentToManual(mapped, s);
    return { moodleId: mapped, realAccount: hasReal };
  }

  const idnumber = studentIdnumber(s.id);
  const existing = await findStudentByIdnumber(idnumber);
  if (existing != null) {
    await saveMapping("STUDENT", s.id, existing, idnumber);
    if (hasReal && opts.forceUpdate) await upgradeStudentToManual(existing, s);
    return { moodleId: existing, realAccount: hasReal };
  }

  const createdId = await createStudentMoodleUser(s, hasReal);
  return { moodleId: createdId, realAccount: hasReal };
}

/**
 * Camino del outbox (`STUDENT_USER_UPSERT`): **sólo propaga** cambios de datos a una cuenta que
 * ya existe.
 *
 * No crea cuentas ni manda bienvenidas. Crear es siempre una acción explícita de administración
 * (`provisionStudentMoodleAccount`, detrás de `POST /admin/students/:id/moodle-account`). Sin este
 * corte, cualquier `enqueueStudentUserUpsert` volvería a crear cuentas —y a mandar mails con
 * contraseña temporal— en silencio: es justo lo que pasaba cuando a un alumno con espejo `nologin`
 * se le agregaba el email más tarde.
 */
export async function syncMoodleStudentById(studentId: string): Promise<void> {
  if (!isMoodleIntegrationEnabled()) return;
  if ((await getMappedId("STUDENT", studentId)) == null) return;

  const s = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
    },
  });
  if (!s) return;

  await ensureStudentMoodleAccount(s, { forceUpdate: true });
}

/**
 * Alta explícita de la cuenta Moodle del alumno (`POST /admin/students/:id/moodle-account`).
 *
 * Es síncrona a propósito: para una acción manual, fallar a la vista de quien la disparó es mejor
 * que reintentar de forma invisible. `sendWelcomeOnce` toma un claim atómico sobre
 * `moodleWelcomeSentAt`, así que tocar el botón dos veces no manda dos mails.
 */
export async function provisionStudentMoodleAccount(
  studentId: string,
): Promise<{ moodleId: number; welcomeSentAt: Date | null; alreadyLinked: boolean }> {
  if (!isMoodleIntegrationEnabled()) throw new Error("MOODLE_NOT_CONFIGURED");
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      moodleWelcomeSentAt: true,
    },
  });
  if (!student) throw new Error("MOODLE_STUDENT_NOT_FOUND");
  if (!realAccountData(student)) throw new Error("MOODLE_STUDENT_ACCOUNT_FIELDS_REQUIRED");

  const alreadyLinked = (await getMappedId("STUDENT", studentId)) != null;
  const { moodleId } = await ensureStudentMoodleAccount(student, { forceUpdate: true });

  if (student.moodleWelcomeSentAt) {
    return { moodleId, welcomeSentAt: student.moodleWelcomeSentAt, alreadyLinked };
  }
  await sendWelcomeOnce(studentId, moodleId, student.email!, student.firstName, student.username!);
  const after = await prisma.student.findUnique({
    where: { id: studentId },
    select: { moodleWelcomeSentAt: true },
  });
  return { moodleId, welcomeSentAt: after?.moodleWelcomeSentAt ?? null, alreadyLinked };
}

async function sendWelcomeOnce(
  studentId: string,
  moodleId: number,
  email: string,
  firstName: string,
  username: string,
): Promise<void> {
  const claimed = await prisma.student.updateMany({
    where: { id: studentId, moodleWelcomeSentAt: null },
    data: { moodleWelcomeSentAt: new Date() },
  });
  if (claimed.count !== 1) return;
  try {
    // Fijamos la contraseña temporal recién con el claim tomado para no resetearla
    // en cada sync ni pisarla entre ticks concurrentes del outbox.
    const tempPassword = readableTempPassword();
    await setStudentTempPassword(moodleId, tempPassword);
    await sendStudentWelcomeEmail({ to: email, firstName, username, tempPassword });
  } catch (e) {
    // Liberar el claim para que el outbox reintente el envío con backoff.
    await prisma.student
      .updateMany({ where: { id: studentId }, data: { moodleWelcomeSentAt: null } })
      .catch(() => {});
    throw e;
  }
}

/**
 * Regenera las credenciales temporales y reenvía la bienvenida mientras la cuenta todavía no
 * completó su primer acceso. No permite resetear desde este botón a un alumno ya verificado.
 */
export async function resendStudentMoodleWelcome(studentId: string): Promise<Date> {
  if (!isMoodleIntegrationEnabled()) throw new Error("MOODLE_NOT_CONFIGURED");
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, firstName: true, lastName: true, email: true, username: true },
  });
  if (!student) throw new Error("MOODLE_STUDENT_NOT_FOUND");
  const real = realAccountData(student);
  if (!real) throw new Error("MOODLE_STUDENT_ACCOUNT_FIELDS_REQUIRED");

  const before = await getStudentMoodleVerifications([studentId]);
  if (before.get(studentId)?.verified) throw new Error("MOODLE_STUDENT_ALREADY_VERIFIED");

  const { moodleId } = await ensureStudentMoodleAccount(student, { forceUpdate: true });
  const tempPassword = readableTempPassword();
  await setStudentTempPassword(moodleId, tempPassword);
  await sendStudentWelcomeEmail({
    to: real.email,
    firstName: student.firstName,
    username: real.username,
    tempPassword,
  });

  const sentAt = new Date();
  await prisma.student.updateMany({ where: { id: studentId }, data: { moodleWelcomeSentAt: sentAt } });
  return sentAt;
}
