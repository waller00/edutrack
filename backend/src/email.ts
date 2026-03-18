import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST!;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER!;
const smtpPass = process.env.SMTP_PASS!;
const smtpFrom = process.env.SMTP_FROM || `no-reply@${new URL(process.env.FRONTEND_URL!).hostname}`;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: { user: smtpUser, pass: smtpPass },
});

export async function sendMail(options: { to: string; subject: string; html: string; text?: string }) {
  await transporter.sendMail({ from: smtpFrom, ...options });
} 