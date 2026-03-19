import "dotenv/config";
import express from "express";
import cors from "cors";
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

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

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
