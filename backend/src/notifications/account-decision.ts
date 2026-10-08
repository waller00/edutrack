import { sendMail } from "./email.js";

/**
 * Correos de la decisión de administración sobre una cuenta registrada: aprobada o rechazada.
 * Sin ellos, quien se registra no se entera de nada hasta que prueba entrar.
 */

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function greeting(firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  return name ? `Hola ${name},` : "Hola,";
}

export function buildApprovalEmail(args: { firstName?: string | null; loginUrl: string }) {
  const hello = greeting(args.firstName);
  const url = escapeHtml(args.loginUrl);
  return {
    subject: "Tu cuenta de EduTrack fue aprobada",
    html: [
      `<p>${escapeHtml(hello)}</p>`,
      "<p>Administración aprobó tu cuenta de EduTrack. Ya podés ingresar:</p>",
      `<p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#047857;color:#ffffff;text-decoration:none;font-weight:600">Ingresar a EduTrack</a></p>`,
      `<p>Si el botón no funciona, copiá este enlace en el navegador:<br><a href="${url}">${url}</a></p>`,
    ].join(""),
    text: `${hello}\n\nAdministración aprobó tu cuenta de EduTrack. Ya podés ingresar: ${args.loginUrl}`,
  };
}

/**
 * El motivo lo escribe administración y es opcional. Se aclara que los datos se borraron: es lo
 * que habilita a registrarse de nuevo con el mismo correo si fue un error.
 */
export function buildRejectionEmail(args: { firstName?: string | null; reason?: string | null }) {
  const hello = greeting(args.firstName);
  const reason = (args.reason ?? "").trim();
  const erased =
    "Borramos los datos que cargaste al registrarte. Si creés que es un error, comunicate con la institución.";
  return {
    subject: "Tu solicitud de cuenta en EduTrack no fue aprobada",
    html: [
      `<p>${escapeHtml(hello)}</p>`,
      "<p>Administración revisó tu solicitud de cuenta en EduTrack y no la aprobó.</p>",
      reason ? `<p>Motivo: ${escapeHtml(reason)}</p>` : "",
      `<p>${erased}</p>`,
    ].join(""),
    text: [
      hello,
      "",
      "Administración revisó tu solicitud de cuenta en EduTrack y no la aprobó.",
      ...(reason ? ["", `Motivo: ${reason}`] : []),
      "",
      erased,
    ].join("\n"),
  };
}

export async function sendApprovalEmail(user: { email: string; firstName?: string | null }): Promise<void> {
  const loginUrl = `${process.env.FRONTEND_URL ?? ""}/login`;
  await sendMail({ to: user.email, ...buildApprovalEmail({ firstName: user.firstName, loginUrl }) });
}

export async function sendRejectionEmail(user: {
  email: string;
  firstName?: string | null;
  reason?: string | null;
}): Promise<void> {
  await sendMail({ to: user.email, ...buildRejectionEmail({ firstName: user.firstName, reason: user.reason }) });
}
