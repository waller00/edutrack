import "dotenv/config";
// Primero que las rutas: hace que el rechazo de un handler async llegue al manejador de errores.
import "./lib/async-errors.js";
/** En Windows, `fetch`/undici a veces eligiendo IPv6 mal enrutado; priorizamos IPv4 (misma API que curl). */
import dns from "node:dns";
import express from "express";
import * as Sentry from "@sentry/node";
import cors from "cors";
import type { CorsOptions } from "cors";
import helmet from "helmet";
import { accessLog } from "./middlewares/access-log.js";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import keycloakAuthRoutes from "./routes/auth-keycloak.js";
import { rateLimit } from "./middlewares/rate-limit.js";
import { trustImmediatePrivateProxy } from "./lib/client-ip.js";
import { isAllowedOrigin } from "./lib/allowed-origins.js";
import { originCheck } from "./middlewares/origin-check.js";
import securityRoutes from "./routes/security.js";
import { jsonErrorHandler } from "./lib/error-handler.js";
import { requestCacheMiddleware } from "./lib/request-cache.js";
import adminRoutes from "./routes/admin.js";
import adminTestingRoutes from "./routes/admin-testing.js";
import attendanceRoutes from "./routes/attendance.js";
import studentAttendanceRoutes from "./routes/student-attendance.js";
import eventsRoutes from "./routes/events.js";
import coursesRoutes from "./routes/courses.js";
import medicalLeavesRoutes from "./routes/medical-leaves.js";
import nonWorkingDaysRoutes from "./routes/non-working-days.js";
import reportsRoutes from "./routes/reports.js";
import analyticsRoutes from "./routes/analytics.js";
import exportsRoutes from "./routes/exports.js";
import webPushRoutes from "./routes/web-push.js";
import inAppNotificationRoutes from "./routes/in-app-notifications.js";
import messagesRoutes from "./routes/messages.js";
import biometricAdmsRoutes from "./routes/biometric-adms.js";
import biometricLinkRoutes from "./routes/biometric-link.js";
import zktecoIclockRoutes from "./routes/zkteco-iclock.js";
import attendanceIncidentsRoutes from "./routes/attendance-incidents.js";
import substitutionsRoutes from "./routes/substitutions.js";
import gradebookRoutes from "./routes/gradebook.js";
import { httpMetricsMiddleware } from "./observability/metrics.js";
import { checkReadiness } from "./observability/readiness.js";

dns.setDefaultResultOrder("ipv4first");

const app = express();

const corsOptions: CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
};
// 1. Forzar que responda a los OPTIONS antes que nada
app.options("*", cors(corsOptions));

// 2. Confiar en el proxy propio (nginx detrás de Cloudflare), y sólo si conecta desde una red
// privada: un cliente que pega directo al puerto de la API no puede dictar su IP.
app.set("trust proxy", trustImmediatePrivateProxy);

// CORS primero: el preflight OPTIONS debe recibir cabeceras aunque Helmet limite otras cosas.
app.use(cors(corsOptions));
app.use(
  helmet({
    // Por defecto Helmet puede usar CORP same-origin y romper respuestas consumidas desde otro subdominio.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Un año, igual que el front (nginx): con el de fábrica de Helmet (180 días) no coincidían.
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  }),
);
// Sin query string ni colores ANSI: los logs van a Loki.
app.use(accessLog());
app.use(httpMetricsMiddleware);

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
// CSRF: una escritura desde un origen que no es el front se corta antes de leer el cuerpo.
app.use(originCheck());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());
// Después de los parsers de cuerpo: así toda la cadena de la ruta corre dentro del mismo pedido.
app.use(requestCacheMiddleware);

app.use("/auth/login", rateLimit({ bucket: "login", max: 10, windowSeconds: 60 }));
// Público (sin sesión): cada pedido puede mandar un correo, así que se acota por IP además de la
// espera por usuario que aplica la ruta.
app.use("/auth/verify/request", rateLimit({ bucket: "verify-request", max: 5, windowSeconds: 600 }));
app.use("/auth", keycloakAuthRoutes);
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/admin/testing", adminTestingRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/student-attendance", studentAttendanceRoutes);
app.use("/events", eventsRoutes);
app.use("/courses", coursesRoutes);
app.use("/medical-leaves", medicalLeavesRoutes);
app.use("/non-working-days", nonWorkingDaysRoutes);
app.use("/reports", reportsRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/exports", exportsRoutes);
app.use("/notifications/web-push", webPushRoutes);
app.use("/notifications/in-app", inAppNotificationRoutes);
app.use("/messages", messagesRoutes);
// ADMS antes que la vinculación: ese router pide sesión a todo `/biometric` (`r.use(authGuard)`) y,
// montado primero, le contestaba "No autorizado" al lector antes de que se mirara su secreto.
app.use("/biometric", biometricAdmsRoutes);
app.use("/biometric", biometricLinkRoutes);
app.use("/attendance-incidents", attendanceIncidentsRoutes);
app.use("/substitutions", substitutionsRoutes);
app.use("/gradebook", gradebookRoutes);
app.use("/security", securityRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/ready", async (_req, res) => {
  const result = await checkReadiness();
  res.status(result.ok ? 200 : 503).json({ ok: result.ok });
});

// Ruta inexistente: JSON como el resto de la API, no la página HTML de Express.
app.use((_req, res) => {
  res.status(404).json({ message: "No encontrado" });
});

// Captura de errores de Express en Sentry (no-op si SENTRY_DSN no esta definido).
Sentry.setupExpressErrorHandler(app);
app.use(jsonErrorHandler);

export default app;
