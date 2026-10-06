import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";
import { sendMail } from "../notifications/email.js";

/** Vigencia del enlace de verificación de correo. */
const VERIFY_TTL_HOURS = 24;

/**
 * Espera mínima entre dos envíos al mismo usuario. La pantalla muestra la misma cuenta regresiva,
 * así que tocar "Reenviar" repetido no gasta envíos (el plan de correo tiene cupo diario).
 */
export const VERIFY_RESEND_COOLDOWN_SECONDS = 60;

type VerificationTarget = { id: string; email: string };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Texto del correo. A quien se acaba de registrar se le explica el paso siguiente: verificar no
 * habilita el acceso, después administración tiene que aprobar la cuenta.
 */
export function buildVerificationEmail(verifyUrl: string, opts: { pendingApproval: boolean }) {
  const url = escapeHtml(verifyUrl);
  const next = opts.pendingApproval
    ? "Después de verificarlo, administración revisa tu cuenta y la aprueba. Recién ahí vas a poder ingresar."
    : "Después de verificarlo vas a poder seguir usando EduTrack con normalidad.";
  return {
    subject: "Verificá tu correo en EduTrack",
    html: [
      "<p>Hola,</p>",
      "<p>Para continuar con tu cuenta de EduTrack, confirmá que este correo es tuyo:</p>",
      `<p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#047857;color:#ffffff;text-decoration:none;font-weight:600">Verificar mi correo</a></p>`,
      `<p>Si el botón no funciona, copiá este enlace en el navegador:<br><a href="${url}">${url}</a></p>`,
      `<p>El enlace vence en ${VERIFY_TTL_HOURS} horas. ${next}</p>`,
      "<p>Si no creaste una cuenta en EduTrack, ignorá este correo.</p>",
    ].join(""),
    text:
      `Para continuar con tu cuenta de EduTrack, confirmá tu correo abriendo este enlace: ${verifyUrl}\n\n` +
      `El enlace vence en ${VERIFY_TTL_HOURS} horas. ${next}\n\n` +
      "Si no creaste una cuenta en EduTrack, ignorá este correo.",
  };
}

/** Si el último enlace se mandó hace menos de la espera mínima. */
async function sentRecently(userId: string): Promise<boolean> {
  const last = await prisma.emailVerification.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return Boolean(last && Date.now() - last.createdAt.getTime() < VERIFY_RESEND_COOLDOWN_SECONDS * 1000);
}

/**
 * Genera un enlace nuevo y lo manda. Devuelve `false` si no envió por la espera mínima entre
 * envíos (`ignoreCooldown` la saltea: el registro manda el primero sin mirar). Los enlaces
 * anteriores siguen sirviendo hasta que vencen.
 */
export async function sendVerificationEmail(
  user: VerificationTarget,
  opts: { pendingApproval: boolean; ignoreCooldown?: boolean },
): Promise<boolean> {
  if (!opts.ignoreCooldown && (await sentRecently(user.id))) return false;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000);
  await prisma.emailVerification.create({ data: { token, userId: user.id, expiresAt } });
  const verifyUrl = `${process.env.FRONTEND_URL}/verify?token=${token}`;
  await sendMail({ to: user.email, ...buildVerificationEmail(verifyUrl, { pendingApproval: opts.pendingApproval }) });
  return true;
}
