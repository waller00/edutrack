import { Router } from "express";
import { z } from "zod";
import {
  findBiometricDeviceByCode,
  isBiometricSecretValid,
  processBiometricIngest,
} from "../services/biometric-ingest-core.js";

const r = Router();

const admsIngestSchema = z.object({
  deviceCode: z.string().min(2).max(100),
  deviceUserId: z.string().min(1).max(100),
  timestamp: z.string().datetime(),
  externalId: z.string().min(1).max(150).optional(),
  punchType: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
  payload: z.unknown().optional(),
});

function normalizeIp(ip: string | undefined) {
  if (!ip) return "";
  return ip.replace("::ffff:", "").trim();
}

function resolveRequestIp(req: any) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return normalizeIp(forwarded || req.ip || req.connection?.remoteAddress || "");
}

r.post("/adms-ingest", async (req, res) => {
  const parsed = admsIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Payload ADMS inválido", errors: parsed.error.errors });
  }

  const ingestSecret = String(req.headers["x-biometric-secret"] || "");
  if (!ingestSecret) {
    return res.status(401).json({ message: "Falta x-biometric-secret" });
  }

  const { deviceCode, deviceUserId, timestamp, externalId, punchType, payload } = parsed.data;
  const occurredAt = new Date(timestamp);
  const requestIp = resolveRequestIp(req);

  const device = await findBiometricDeviceByCode(deviceCode);
  if (!device || !device.isActive) {
    return res.status(401).json({ message: "Dispositivo biométrico no autorizado" });
  }

  if (!isBiometricSecretValid(device.secretHash, ingestSecret)) {
    return res.status(401).json({ message: "Credenciales de dispositivo inválidas" });
  }

  if (device.allowedIps.length > 0 && !device.allowedIps.includes(requestIp)) {
    return res.status(403).json({ message: "IP de origen no permitida para este dispositivo" });
  }

  try {
    const result = await processBiometricIngest({
      deviceDbId: device.id,
      deviceCode: device.code,
      deviceUserId,
      occurredAt,
      externalId,
      punchType,
      payload: payload ?? req.body,
    });

    if (result.ok === false) {
      if (result.reason === "NO_MAPPING") {
        return res.status(422).json({
          message: "No existe mapeo biométrico para el usuario del dispositivo",
          punchId: result.punchId,
        });
      }
      if (result.reason === "NON_WORKING_DAY") {
        return res.status(403).json({
          message: "Marcación biométrica no permitida: día no laborable / feriado",
          punchId: result.punchId,
        });
      }
      return res.status(403).json({
        message: "Marcación biométrica no permitida por licencia médica activa",
        punchId: result.punchId,
      });
    }

    if (result.duplicate) {
      return res.status(200).json({
        message: "Evento biométrico duplicado (idempotencia aplicada)",
        duplicate: true,
        punchId: result.punchId,
        attendanceId: result.attendanceId,
      });
    }

    return res.status(201).json({
      message: "Marcación biométrica procesada",
      duplicate: false,
      punchId: result.punchId,
      attendance: result.attendance,
      isLate: result.isLate,
    });
  } catch (error) {
    console.error("Error procesando ADMS:", error);
    return res.status(500).json({ message: "Error interno procesando ADMS" });
  }
});

export default r;
