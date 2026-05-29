import "dotenv/config";
/** En Windows, `fetch`/undici a veces eligiendo IPv6 mal enrutado; priorizamos IPv4 (misma API que curl). */
import dns from "node:dns";
import express from "express";
import diditWebhookHandler from "./routes/didit-webhook.js";
import diditLivenessRoutes from "./routes/didit-liveness.js";
import * as Sentry from "@sentry/node";
import cors from "cors";
import type { CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import keycloakAuthRoutes from "./routes/auth-keycloak.js";
import { isKeycloakMode } from "./auth/keycloak.js";
import { rateLimit } from "./middlewares/rate-limit.js";
import passport from "./auth/passportGoogle.js";
import adminRoutes from "./routes/admin.js";
import adminTestingRoutes from "./routes/admin-testing.js";
import attendanceRoutes from "./routes/attendance.js";
import eventsRoutes from "./routes/events.js";
import coursesRoutes from "./routes/courses.js";
import medicalLeavesRoutes from "./routes/medical-leaves.js";
import nonWorkingDaysRoutes from "./routes/non-working-days.js";
import reportsRoutes from "./routes/reports.js";
import analyticsRoutes from "./routes/analytics.js";
import exportsRoutes from "./routes/exports.js";
import webPushRoutes from "./routes/web-push.js";
import inAppNotificationRoutes from "./routes/in-app-notifications.js";
import biometricAdmsRoutes from "./routes/biometric-adms.js";
import biometricLinkRoutes from "./routes/biometric-link.js";
import zktecoIclockRoutes from "./routes/zkteco-iclock.js";
import attendanceIncidentsRoutes from "./routes/attendance-incidents.js";
import substitutionsRoutes from "./routes/substitutions.js";

dns.setDefaultResultOrder("ipv4first");

const app = express();

function normalizeOrigin(url: string): string {
  return url
    .trim()
    .replace(/\r/g, "")
    .replace(/\/$/, "");
}

/** Orígenes permitidos: FRONTEND_URL + lista opcional CORS_ORIGINS (separados por coma), p. ej. https://edutrack-uy.com,https://www.edutrack-uy.com */
function buildAllowedOrigins(): Set<string> {
  const set = new Set<string>();
  const primary = process.env.FRONTEND_URL || "http://localhost:3000";
  set.add(normalizeOrigin(primary));
  const extra = process.env.CORS_ORIGINS;
  if (extra) {
    for (const part of extra.split(",")) {
      const o = normalizeOrigin(part);
      if (o) set.add(o);
    }
  }
  return set;
}

const allowedOrigins = buildAllowedOrigins();

const corsOptions: CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.has(normalized)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
};
// 1. Forzar que responda a los OPTIONS antes que nada
app.options("*", cors(corsOptions));

// 2. Confiar en el proxy (DigitalOcean/Cloudflare)
app.set("trust proxy", 1);

// CORS primero: el preflight OPTIONS debe recibir cabeceras aunque Helmet limite otras cosas.
app.use(cors(corsOptions));
app.use(
  helmet({
    // Por defecto Helmet puede usar CORP same-origin y romper respuestas consumidas desde otro subdominio.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(morgan("dev"));

const iclockTextParser = express.text({
  limit: "10mb",
  type: (req) => !String(req.headers["content-type"] || "").includes("application/json"),
});

// Protocolo push ZKTeco (F22 ADMS): cuerpo texto plano en /iclock/*
// Algunos F22 llaman /cdata o /getrequest sin prefijo → reescritura interna a /iclock/*
app.use((req, _res, next) => {
  const base = req.path.split("?")[0] ?? "";
  if (base === "/cdata" || base === "/getrequest" || base === "/registry" || base === "/devicecmd") {
    req.url = `/iclock${req.url}`;
  }
  next();
});
app.use("/iclock", iclockTextParser, zktecoIclockRoutes);
// Webhook Didit: cuerpo raw para validar HMAC
app.post(
  "/webhooks/didit",
  express.raw({ type: "application/json", limit: "2mb" }),
  diditWebhookHandler,
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());

app.use(passport.initialize());
// Rate limiting de login (Redis): no-op si REDIS_URL no esta definido.
app.use("/auth/login", rateLimit({ bucket: "login", max: 10, windowSeconds: 60 }));
// En modo Keycloak (BFF) las rutas OIDC tienen prioridad sobre el auth legacy.
if (isKeycloakMode()) {
  app.use("/auth", keycloakAuthRoutes);
}
app.use("/auth", authRoutes);
app.use("/auth", diditLivenessRoutes);
app.use("/admin", adminRoutes);
app.use("/admin/testing", adminTestingRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/events", eventsRoutes);
app.use("/courses", coursesRoutes);
app.use("/medical-leaves", medicalLeavesRoutes);
app.use("/non-working-days", nonWorkingDaysRoutes);
app.use("/reports", reportsRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/exports", exportsRoutes);
app.use("/notifications/web-push", webPushRoutes);
app.use("/notifications/in-app", inAppNotificationRoutes);
app.use("/biometric", biometricLinkRoutes);
app.use("/biometric", biometricAdmsRoutes);
app.use("/attendance-incidents", attendanceIncidentsRoutes);
app.use("/substitutions", substitutionsRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Captura de errores de Express en Sentry (no-op si SENTRY_DSN no esta definido).
Sentry.setupExpressErrorHandler(app);

export default app;
