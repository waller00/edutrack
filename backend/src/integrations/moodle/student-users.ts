import { randomBytes } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { isMoodleIntegrationEnabled, moodleRest, moodleUserLang } from "./client.js";
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

function studentIdnumber(studentId: string): string {
  return `et-student-${studentId}`;
}

function numericField(row: unknown, key: string): number | null {
  if (row && typeof row === "object" && key in row) {
    const v = Number((row as Record<string, unknown>)[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
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

/** Fija una contraseña temporal y fuerza el cambio en el primer ingreso del alumno. */
async function setStudentTempPassword(moodleId: number, password: string): Promise<void> {
  await moodleRest("core_user_update_users", {
    "users[0][id]": String(moodleId),
    ["users[0][pass" + "word]"]: password,
    "users[0][preferences][0][type]": "auth_forcepasswordchange",
    "users[0][preferences][0][value]": "1",
  });
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
    "users[0][lang]": moodleUserLang(),
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
    "users[0][lang]": moodleUserLang(),
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
 * Camino del outbox (`STUDENT_USER_UPSERT`): sincroniza la cuenta y dispara el mail de
 * bienvenida exactamente una vez (claim atómico sobre `moodleWelcomeSentAt`).
 */
export async function syncMoodleStudentById(studentId: string): Promise<void> {
  if (!isMoodleIntegrationEnabled()) return;
  const s = await prisma.student.findUnique({
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
  if (!s) return;

  const { moodleId, realAccount } = await ensureStudentMoodleAccount(s, { forceUpdate: true });
  if (!realAccount || s.moodleWelcomeSentAt) return;
  await sendWelcomeOnce(s.id, moodleId, s.email!, s.firstName, s.username!);
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
