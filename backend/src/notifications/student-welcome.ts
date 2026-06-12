import { sendMail } from "./email.js";
import { moodlePublicUrl } from "../integrations/moodle/client.js";

/**
 * Mail de bienvenida al aula virtual para estudiantes con cuenta Moodle real.
 * Incluye el username, el link a Moodle y el link para establecer la contraseña
 * (flujo `forgot_password` de Moodle: el token de reset expira en ~30 min, por lo
 * que el alumno debe iniciarlo cuando abre el mail, no nosotros al crear la cuenta).
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
  moodleUrl: string;
}): { subject: string; html: string; text: string } {
  const moodleUrl = args.moodleUrl.replace(/\/+$/, "");
  const passwordUrl = `${moodleUrl}/login/forgot_password.php`;
  const firstName = args.firstName.trim() || "estudiante";
  const subject = "Tu cuenta del aula virtual (Moodle)";

  const text = [
    `Hola ${firstName},`,
    "",
    "Te creamos una cuenta en el aula virtual (Moodle).",
    "",
    `Usuario: ${args.username}`,
    `Aula virtual: ${moodleUrl}`,
    "",
    "Para elegir tu contraseña, entrá al siguiente link e ingresá tu usuario o este correo:",
    passwordUrl,
    "",
    "Después de establecerla vas a poder entrar al aula virtual con tu usuario y contraseña.",
  ].join("\n");

  const html = `
    <p>Hola ${escapeHtml(firstName)},</p>
    <p>Te creamos una cuenta en el <strong>aula virtual (Moodle)</strong>.</p>
    <p>
      Usuario: <strong>${escapeHtml(args.username)}</strong><br/>
      Aula virtual: <a href="${moodleUrl}">${moodleUrl}</a>
    </p>
    <p>
      Para elegir tu contraseña, entrá al siguiente link e ingresá tu usuario o este correo:<br/>
      <a href="${passwordUrl}">${passwordUrl}</a>
    </p>
    <p>Después de establecerla vas a poder entrar al aula virtual con tu usuario y contraseña.</p>
  `;

  return { subject, html, text };
}

export async function sendStudentWelcomeEmail(args: {
  to: string;
  firstName: string;
  username: string;
}): Promise<void> {
  const moodleUrl = moodlePublicUrl();
  if (!moodleUrl) throw new Error("MOODLE_PUBLIC_URL_NOT_CONFIGURED");
  const { subject, html, text } = buildStudentWelcomeEmail({
    firstName: args.firstName,
    username: args.username,
    moodleUrl,
  });
  await sendMail({ to: args.to, subject, html, text });
}
