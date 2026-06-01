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

/** SendGrid SMTP (587) suele estar bloqueado en Droplets (p. ej. DO); la API v3 va por HTTPS 443. */
function shouldUseSendGridHttpApi(): boolean {
  if (process.env.SENDGRID_HTTP_API === "0" || process.env.SENDGRID_HTTP_API === "false") return false;
  const host = (process.env.SMTP_HOST || "").trim().toLowerCase();
  const user = (process.env.SMTP_USER || "").trim().toLowerCase();
  return host === "smtp.sendgrid.net" && user === "apikey" && Boolean((process.env.SMTP_PASS || "").trim());
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

async function sendMailSendGridApi(options: { to: string; subject: string; html: string; text?: string }) {
  const apiKey = (process.env.SMTP_PASS || "").trim();
  const from = parseFromHeader(smtpFrom);
  const content: { type: string; value: string }[] = [];
  if (options.text) content.push({ type: "text/plain", value: options.text });
  content.push({ type: "text/html", value: options.html });

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    signal: AbortSignal.timeout(Number(process.env.SENDGRID_HTTP_TIMEOUT_MS || 10000)),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: options.to }] }],
      from: {
        email: from.email,
        ...(from.name ? { name: from.name } : {}),
      },
      subject: options.subject,
      content,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid API ${res.status}: ${body.slice(0, 400)}`);
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
  if (shouldUseSendGridHttpApi()) {
    await sendMailSendGridApi(options);
    return;
  }
  await transporter.sendMail({ from: smtpFrom, ...options });
}
