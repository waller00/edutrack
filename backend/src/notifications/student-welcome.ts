import { sendMail } from "./email.js";
import { moodlePublicUrl } from "../integrations/moodle/client.js";

/**
 * Mail de bienvenida al aula virtual para estudiantes con cuenta Moodle real.
 * Incluye el username y una contraseña temporal: el alumno entra con ellas y Moodle
 * lo lleva directo a crear su contraseña definitiva (preferencia `auth_forcepasswordchange`),
 * sin pasar por la página de "recuperar contraseña".
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildStudentWelcomeEmail(args: {
  firstName: string;
  username: string;
  tempPassword: string;
  moodleUrl: string;
}): { subject: string; html: string; text: string } {
  const moodleUrl = args.moodleUrl.replace(/\/+$/, "");
  const loginUrl = `${moodleUrl}/login/index.php`;
  const firstName = args.firstName.trim() || "estudiante";
  const subject = "Tu cuenta del aula virtual (Moodle)";

  const text = [
    `Hola ${firstName},`,
    "",
    "Te creamos una cuenta en el aula virtual (Moodle).",
    "",
    `Usuario: ${args.username}`,
    `Contraseña temporal: ${args.tempPassword}`,
    `Aula virtual: ${loginUrl}`,
    "",
    "Iniciá sesión con esos datos y el aula virtual te va a pedir crear tu contraseña definitiva.",
  ].join("\n");

  const html = `
    <p>Hola ${escapeHtml(firstName)},</p>
    <p>Te creamos una cuenta en el <strong>aula virtual (Moodle)</strong>.</p>
    <p>
      Usuario: <strong>${escapeHtml(args.username)}</strong><br/>
      Contraseña temporal: <strong>${escapeHtml(args.tempPassword)}</strong><br/>
      Aula virtual: <a href="${loginUrl}">${loginUrl}</a>
    </p>
    <p>Iniciá sesión con esos datos y el aula virtual te va a pedir crear tu contraseña definitiva.</p>
  `;

  return { subject, html, text };
}

export async function sendStudentWelcomeEmail(args: {
  to: string;
  firstName: string;
  username: string;
  tempPassword: string;
}): Promise<void> {
  const moodleUrl = moodlePublicUrl();
  if (!moodleUrl) throw new Error("MOODLE_PUBLIC_URL_NOT_CONFIGURED");
  const { subject, html, text } = buildStudentWelcomeEmail({
    firstName: args.firstName,
    username: args.username,
    tempPassword: args.tempPassword,
    moodleUrl,
  });
  await sendMail({ to: args.to, subject, html, text });
}
