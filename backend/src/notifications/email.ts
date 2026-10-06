import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST!;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER!;
const smtpPass = process.env.SMTP_PASS!;
function resolveDefaultFromAddress() {
  const frontendUrl = (process.env.FRONTEND_URL || "").trim();
  if (frontendUrl) {
    try {
      return `no-reply@${new URL(frontendUrl).hostname}`;
    } catch {
      // fallback local si FRONTEND_URL es inválida
    }
  }
  return "no-reply@localhost";
}
const smtpFrom = process.env.SMTP_FROM || resolveDefaultFromAddress();

/**
 * Con `BREVO_API_KEY` el correo sale por la API transaccional de Brevo (HTTPS 443): el SMTP (587)
 * suele estar bloqueado en Droplets (p. ej. DO). Sin la clave se usa el SMTP genérico de abajo.
 */
function brevoApiKey(): string | null {
  return (process.env.BREVO_API_KEY || "").trim() || null;
}

function parseFromHeader(from: string): { email: string; name?: string } {
  const t = from.trim();
  const emailStart = t.lastIndexOf("<");
  const emailEnd = t.endsWith(">") ? t.length - 1 : -1;
  if (emailStart > 0 && emailEnd > emailStart) {
    const rawName = t.slice(0, emailStart).trim();
    const first = rawName[0];
    const last = rawName[rawName.length - 1];
    const quoted = rawName.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"));
    const name = (quoted ? rawName.slice(1, -1) : rawName).trim();
    const email = t.slice(emailStart + 1, emailEnd).trim();
    if (name) return { email, name };
    return { email };
  }
  return { email: t };
}

async function sendMailBrevoApi(
  apiKey: string,
  options: { to: string; subject: string; html: string; text?: string },
) {
  const sender = parseFromHeader(smtpFrom);

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    signal: AbortSignal.timeout(Number(process.env.BREVO_HTTP_TIMEOUT_MS || 10000)),
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: options.to }],
      subject: options.subject,
      htmlContent: options.html,
      ...(options.text ? { textContent: options.text } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API ${res.status}: ${body.slice(0, 400)}`);
  }
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: { user: smtpUser, pass: smtpPass },
  // Sin estos timeouts, si el puerto SMTP está bloqueado (típico en Droplets DO con 587)
  // sendMail queda colgado ~1-2 min y arrastra al request que lo llama (p. ej. /auth/register),
  // que termina cortado por el proxy sin cabeceras CORS. Mejor fallar rápido.
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 8000),
  greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 8000),
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 10000),
});

export async function sendMail(options: { to: string; subject: string; html: string; text?: string }) {
  const apiKey = brevoApiKey();
  if (apiKey) {
    await sendMailBrevoApi(apiKey, options);
    return;
  }
  await transporter.sendMail({ from: smtpFrom, ...options });
}
