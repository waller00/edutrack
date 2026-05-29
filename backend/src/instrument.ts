import "dotenv/config";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

/**
 * Inicializacion de Sentry para el backend.
 *
 * Debe importarse ANTES que cualquier otro modulo (ver server.ts) para que la
 * instrumentacion automatica de Express/HTTP/Prisma funcione correctamente.
 *
 * Se activa solo si SENTRY_DSN esta definido, asi en local/CI no envia nada.
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
  const tracesSampleRate = Number(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? (environment === "production" ? "0.1" : "1.0"),
  );
  const profilesSampleRate = Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? "0");

  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE || process.env.GIT_SHA,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
    profilesSampleRate: Number.isFinite(profilesSampleRate) ? profilesSampleRate : 0,
    integrations: profilesSampleRate > 0 ? [nodeProfilingIntegration()] : [],
    // No enviar PII por defecto (IP, headers de usuario, etc.).
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });

  console.log(`[sentry] backend habilitado (env=${environment})`);
}

/**
 * Elimina datos sensibles (cedula, tokens, contrasenas, cookies, emails) antes
 * de enviar el evento. EduTrack maneja datos de menores y documentos.
 */
const SENSITIVE_KEYS = [
  "password",
  "passwordhash",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "set-cookie",
  "nationalid",
  "national_id",
  "cedula",
  "twofactorsecret",
  "jwt_secret",
];

function scrubEvent(event: any): any {
  try {
    if (event.request) {
      delete event.request.cookies;
      if (event.request.headers) scrubObject(event.request.headers);
      if (event.request.data) scrubObject(event.request.data);
      if (event.request.query_string) event.request.query_string = "[Filtered]";
    }
    if (event.user) {
      // Conservar solo el id; quitar email y datos personales.
      event.user = { id: event.user.id };
    }
    if (event.extra) scrubObject(event.extra);
  } catch {
    // Si el scrubbing falla, preferimos no enviar el evento.
    return event;
  }
  return event;
}

function scrubObject(obj: Record<string, any>) {
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      obj[key] = "[Filtered]";
    } else if (obj[key] && typeof obj[key] === "object") {
      scrubObject(obj[key]);
    }
  }
}
