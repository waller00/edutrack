import { Router } from "express";
import { z } from "zod";
import { authGuard } from "../middlewares/auth.js";
import { clientIpFromRequest } from "../services/audit-log.js";
import {
  biometricLinkTtlSeconds,
  cancelBiometricLinkRequest,
  confirmBiometricLinkRequest,
  createBiometricLinkRequest,
  deactivateUserBiometricMapping,
  getActiveBiometricLinkRequest,
  getUserBiometricMapping,
  listActiveBiometricDevices,
} from "../services/biometric-link.js";

const r = Router();
r.use(authGuard);

const createLinkSchema = z.object({
  deviceId: z.string().uuid().optional(),
  deviceCode: z.string().min(2).max(100).optional(),
});

function getUserId(req: { user?: { sub?: string; id?: string } }) {
  return req.user?.id ?? req.user?.sub ?? "";
}

r.get("/devices", async (_req, res) => {
  const devices = await listActiveBiometricDevices();
  return res.json({ devices });
});

r.get("/me/mapping", async (req, res) => {
  const userId = getUserId(req as any);
  const mapping = await getUserBiometricMapping(userId);
  return res.json({ mapping });
});

r.delete("/me/mapping", async (req, res) => {
  const userId = getUserId(req as any);
  const result = await deactivateUserBiometricMapping(userId, req);
  if (!result.ok) {
    return res.status(404).json({ message: "No tenés un lector vinculado" });
  }
  return res.json({ message: "Vínculo biométrico eliminado" });
});

r.get("/link-requests/active", async (req, res) => {
  const userId = getUserId(req as any);
  const linkRequest = await getActiveBiometricLinkRequest(userId);
  const mapping = await getUserBiometricMapping(userId);
  return res.json({
    linkRequest,
    mapping,
    ttlSeconds: biometricLinkTtlSeconds(),
  });
});

r.post("/link-requests", async (req, res) => {
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.errors });
  }

  const userId = getUserId(req as any);
  const result = await createBiometricLinkRequest({
    userId,
    deviceId: parsed.data.deviceId,
    deviceCode: parsed.data.deviceCode,
    actorIp: clientIpFromRequest(req),
    req,
  });

  if (!result.ok) {
    const messages: Record<string, { status: number; message: string }> = {
      USER_INACTIVE: { status: 403, message: "Tu cuenta no está activa o aprobada" },
      ROLE_NOT_ALLOWED: { status: 403, message: "Tu rol no puede vincular lector biométrico" },
      ALREADY_LINKED: { status: 409, message: "Ya tenés un lector vinculado. Desvinculá antes de crear uno nuevo." },
      RATE_LIMIT: { status: 429, message: "Demasiados intentos de vinculación hoy. Probá mañana." },
      NO_DEVICES: { status: 503, message: "No hay lectores biométricos configurados" },
      DEVICE_REQUIRED: { status: 400, message: "Hay varios lectores; indicá deviceId o deviceCode" },
      DEVICE_NOT_FOUND: { status: 404, message: "Lector no encontrado" },
      DEVICE_BUSY: { status: 409, message: "Otro usuario está vinculando en ese lector. Esperá un momento." },
    };
    const info = messages[result.reason] ?? { status: 400, message: "No se pudo iniciar la vinculación" };
    return res.status(info.status).json({
      message: info.message,
      reason: result.reason,
      mapping: "mapping" in result ? result.mapping : undefined,
      devices: "devices" in result ? result.devices : undefined,
    });
  }

  return res.status(201).json({
    linkRequest: result.linkRequest,
    ttlSeconds: biometricLinkTtlSeconds(),
  });
});

r.post("/link-requests/:id/confirm", async (req, res) => {
  const userId = getUserId(req as any);
  const result = await confirmBiometricLinkRequest({
    userId,
    linkRequestId: req.params.id,
    req,
  });

  if (!result.ok) {
    const messages: Record<string, { status: number; message: string }> = {
      NOT_FOUND: { status: 404, message: "Solicitud no encontrada" },
      INVALID_STATUS: { status: 409, message: "La solicitud no está lista para confirmar" },
      EXPIRED: { status: 410, message: "La solicitud expiró. Iniciá de nuevo." },
      NO_CANDIDATE: { status: 409, message: "Aún no se detectó una marca en el lector" },
      PIN_TAKEN: { status: 409, message: "Ese PIN del lector ya está vinculado a otro usuario" },
    };
    const info = messages[result.reason] ?? { status: 400, message: "No se pudo confirmar" };
    return res.status(info.status).json({ message: info.message, reason: result.reason, status: result.status });
  }

  return res.json({
    message: "Huella vinculada correctamente",
    mapping: result.mapping,
    attendance: result.attendance,
  });
});

r.post("/link-requests/:id/cancel", async (req, res) => {
  const userId = getUserId(req as any);
  const result = await cancelBiometricLinkRequest({
    userId,
    linkRequestId: req.params.id,
    req,
  });

  if (!result.ok) {
    return res.status(404).json({ message: "Solicitud no encontrada" });
  }

  return res.json({ message: "Vinculación cancelada" });
});

export default r;
