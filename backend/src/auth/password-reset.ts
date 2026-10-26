import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";
import { sendMail } from "../notifications/email.js";
import { keycloakUserHasPassword, resetKeycloakPassword } from "./keycloak.js";
import { deleteSessionsForUser } from "./session-store.js";

/**
 * "Olvidé mi contraseña" por EduTrack. El correo sale por el mismo canal que la verificación
 * (Brevo, HTTPS): el de Keycloak necesita un SMTP, y el droplet tiene bloqueados sus puertos.
 */

/** Vigencia del enlace. Corta: quien pide recuperar la contraseña lo usa enseguida. */
export const PASSWORD_RESET_TTL_MINUTES = 60;

/** Espera mínima entre dos correos al mismo usuario (el plan de correo tiene cupo diario). */
export const PASSWORD_RESET_COOLDOWN_SECONDS = 60;

/** El enlace no existe, venció o ya se usó. */
export class PasswordResetTokenError extends Error {
  readonly code = "RESET_TOKEN_INVALID";
  constructor() {
    super("El enlace para restablecer la contraseña venció o ya se usó.");
  }
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * `createsPassword`: la cuenta todavía no tiene contraseña (entra con Google, o la dio de alta
 * administración). El enlace es el mismo; el correo dice que crea una, no que la restablece.
 */
export function buildPasswordResetEmail(resetUrl: string, options: { createsPassword?: boolean } = {}) {
  const url = escapeHtml(resetUrl);
  if (options.createsPassword) {
    return {
      subject: "Creá tu contraseña de EduTrack",
      html: [
        "<p>Hola,</p>",
        "<p>Recibimos un pedido para crear la contraseña de tu cuenta de EduTrack. Con ella vas a poder ingresar también con tu usuario o tu correo, además de con Google.</p>",
        `<p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#047857;color:#ffffff;text-decoration:none;font-weight:600">Crear contraseña</a></p>`,
        `<p>Si el botón no funciona, copiá este enlace en el navegador:<br><a href="${url}">${url}</a></p>`,
        `<p>El enlace vence en ${PASSWORD_RESET_TTL_MINUTES} minutos y sirve una sola vez.</p>`,
        "<p>Si no lo pediste, ignorá este correo: tu cuenta sigue igual.</p>",
      ].join(""),
      text:
        `Para crear la contraseña de tu cuenta de EduTrack, abrí este enlace: ${resetUrl}\n\n` +
        "Con ella vas a poder ingresar también con tu usuario o tu correo, además de con Google.\n\n" +
        `El enlace vence en ${PASSWORD_RESET_TTL_MINUTES} minutos y sirve una sola vez.\n\n` +
        "Si no lo pediste, ignorá este correo: tu cuenta sigue igual.",
    };
  }
  return {
    subject: "Restablecé tu contraseña de EduTrack",
    html: [
      "<p>Hola,</p>",
      "<p>Recibimos un pedido para restablecer la contraseña de tu cuenta de EduTrack. Para elegir una nueva:</p>",
      `<p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#047857;color:#ffffff;text-decoration:none;font-weight:600">Elegir contraseña nueva</a></p>`,
      `<p>Si el botón no funciona, copiá este enlace en el navegador:<br><a href="${url}">${url}</a></p>`,
      `<p>El enlace vence en ${PASSWORD_RESET_TTL_MINUTES} minutos y sirve una sola vez.</p>`,
      "<p>Si no lo pediste, ignorá este correo: tu contraseña no cambia.</p>",
    ].join(""),
    text:
      `Para elegir una contraseña nueva en EduTrack, abrí este enlace: ${resetUrl}\n\n` +
      `El enlace vence en ${PASSWORD_RESET_TTL_MINUTES} minutos y sirve una sola vez.\n\n` +
      "Si no lo pediste, ignorá este correo: tu contraseña no cambia.",
  };
}

/** ¿La cuenta ya tiene contraseña? Si Keycloak no contesta, se asume que sí: el correo de siempre sirve igual. */
async function accountHasPassword(kcId: string): Promise<boolean> {
  try {
    return await keycloakUserHasPassword(kcId);
  } catch {
    return true;
  }
}

async function sentRecently(userId: string): Promise<boolean> {
  const last = await prisma.passwordReset.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return Boolean(last && Date.now() - last.createdAt.getTime() < PASSWORD_RESET_COOLDOWN_SECONDS * 1000);
}

/**
 * Manda el enlace a la cuenta de ese correo. No avisa si la cuenta no existe, está dada de baja o
 * no tiene acceso en Keycloak: quien pide no tiene que poder averiguar qué correos están registrados.
 * Devuelve si envió (para tests y logs, nunca para la respuesta HTTP).
 */
export async function requestPasswordReset(email: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true, email: true, isActive: true, keycloakId: true },
  });
  if (!user || !user.isActive || !user.keycloakId) return false;
  if (await sentRecently(user.id)) return false;

  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordReset.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
    },
  });
  const resetUrl = `${process.env.FRONTEND_URL}/reset?token=${token}`;
  const createsPassword = !(await accountHasPassword(user.keycloakId));
  await sendMail({ to: user.email, ...buildPasswordResetEmail(resetUrl, { createsPassword }) });
  return true;
}

/**
 * Fija la contraseña nueva con un enlace vigente y cierra las sesiones abiertas. El enlace se marca
 * usado recién cuando Keycloak aceptó la contraseña: si la política la rechaza, se puede reintentar.
 * Devuelve el id del usuario (para la auditoría).
 */
export async function completePasswordReset(token: string, password: string): Promise<string> {
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { keycloakId: true, isActive: true } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt.getTime() < Date.now()) throw new PasswordResetTokenError();
  if (!reset.user.isActive || !reset.user.keycloakId) throw new PasswordResetTokenError();

  await resetKeycloakPassword(reset.user.keycloakId, password);
  // Condicional: de dos pedidos simultáneos con el mismo enlace, sólo uno lo da por usado.
  await prisma.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
  await deleteSessionsForUser(reset.userId);
  return reset.userId;
}
