import "dotenv/config";
import express from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import passport from "./passportGoogle.js";
import adminRoutes from "./routes/admin.js";
import attendanceRoutes from "./routes/attendance.js";
import eventsRoutes from "./routes/events.js";
import medicalLeavesRoutes from "./routes/medical-leaves.js";
import reportsRoutes from "./routes/reports.js";
import dniProcessorRoutes from "./routes/dni-processor.js";
import analyticsRoutes from "./routes/analytics.js";
import exportsRoutes from "./routes/exports.js";

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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());

app.use(passport.initialize());
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/events", eventsRoutes);
app.use("/medical-leaves", medicalLeavesRoutes);
app.use("/reports", reportsRoutes);
app.use("/auth", dniProcessorRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/exports", exportsRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

export default app;
