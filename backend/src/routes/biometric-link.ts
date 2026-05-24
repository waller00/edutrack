import { Router } from "express";
import { z } from "zod";
import { authGuard, requirePermission } from "../middlewares/auth.js";
import { clientIpFromRequest } from "../services/audit-log.js";
import {
  biometricLinkTtlSeconds,
  cancelBiometricLinkRequest,
  confirmBiometricLinkRequest,
  createAdminBiometricDevice,
  createBiometricLinkRequest,
  deactivateUserBiometricMapping,
  getActiveBiometricLinkRequest,
  getUserBiometricMapping,
  listAdminBiometricDevices,
  listActiveBiometricDevices,
  updateAdminBiometricDevice,
} from "../services/biometric-link.js";

const r = Router();
r.use(authGuard);

const createLinkSchema = z.object({
  deviceId: z.string().uuid().optional(),
  deviceCode: z.string().min(2).max(100).optional(),
});

const allowedIpsSchema = z.array(z.string().trim().min(1).max(45)).max(20).optional();

const createDeviceSchema = z.object({
  code: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(120),
  secret: z.string().min(8).max(200),
  admsSerial: z.string().trim().min(2).max(100).nullable().optional(),
  timezone: z.string().trim().min(3).max(80).optional(),
  isActive: z.boolean().optional(),
  allowedIps: allowedIpsSchema,
});

const updateDeviceSchema = z.object({
  code: z.string().trim().min(2).max(100).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  secret: z.string().min(8).max(200).optional(),
  admsSerial: z.string().trim().min(2).max(100).nullable().optional(),
  timezone: z.string().trim().min(3).max(80).optional(),
  isActive: z.boolean().optional(),
  allowedIps: allowedIpsSchema,
});

function getUserId(req: { user?: { sub?: string; id?: string } }) {
  return req.user?.id ?? req.user?.sub ?? "";
}

r.get("/devices", requirePermission("users.update", "all"), async (_req, res) => {
  const devices = await listActiveBiometricDevices();
  return res.json({ devices });
});

function biometricDeviceError(res: any, error: any) {
  if (error?.code === "P2025") {
    return res.status(404).json({ message: "Lector no encontrado" });
  }
  if (error?.code === "P2002") {
    return res.status(409).json({ message: "Ya existe un lector con ese código o serial" });
  }
  console.error("Error administrando lector biométrico:", error);
  return res.status(500).json({ message: "Error interno administrando lector" });
}

r.get("/admin/devices", requirePermission("settings.manage", "all"), async (_req, res) => {
  const devices = await listAdminBiometricDevices();
  return res.json({ devices });
});

r.post("/admin/devices", requirePermission("settings.manage", "all"), async (req, res) => {
  const parsed = createDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.errors });
  }

  try {
    const device = await createAdminBiometricDevice({
      code: parsed.data.code!,
      name: parsed.data.name!,
      secret: parsed.data.secret!,
      admsSerial: parsed.data.admsSerial,
      timezone: parsed.data.timezone,
      isActive: parsed.data.isActive,
      allowedIps: parsed.data.allowedIps,
    });
    return res.status(201).json({ device });
  } catch (error) {
    return biometricDeviceError(res, error);
  }
});

r.put("/admin/devices/:id", requirePermission("settings.manage", "all"), async (req, res) => {
  const parsed = updateDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.errors });
  }

  try {
    const device = await updateAdminBiometricDevice(req.params.id, parsed.data);
    return res.json({ device });
  } catch (error) {
    return biometricDeviceError(res, error);
  }
});

r.get("/me/mapping", async (req, res) => {
  const userId = getUserId(req as any);
  const mapping = await getUserBiometricMapping(userId);
  return res.json({ mapping });
});

r.delete("/me/mapping", requirePermission("users.update", "all"), async (req, res) => {
  const userId = getUserId(req as any);
  const result = await deactivateUserBiometricMapping(userId, req);
  if (result.ok === false) {
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

function biometricLinkStartErrorResponse(result: { ok: false; reason: string; mapping?: unknown; devices?: unknown }) {
  const messages: Record<string, { status: number; message: string }> = {
    USER_INACTIVE: { status: 403, message: "La cuenta no está activa o aprobada" },
    ROLE_NOT_ALLOWED: { status: 403, message: "Ese rol no puede vincular lector biométrico" },
    ALREADY_LINKED: { status: 409, message: "El usuario ya tiene un lector vinculado. Desvinculá antes de crear uno nuevo." },
    RATE_LIMIT: { status: 429, message: "Demasiados intentos de vinculación hoy. Probá mañana." },
    NO_DEVICES: { status: 503, message: "No hay lectores biométricos configurados" },
    DEVICE_REQUIRED: { status: 400, message: "Hay varios lectores; indicá deviceId o deviceCode" },
    DEVICE_NOT_FOUND: { status: 404, message: "Lector no encontrado" },
    DEVICE_BUSY: { status: 409, message: "Otro usuario está vinculando en ese lector. Esperá un momento." },
  };
  const info = messages[result.reason] ?? { status: 400, message: "No se pudo iniciar la vinculación" };
  return {
    status: info.status,
    body: {
      message: info.message,
      reason: result.reason,
      mapping: "mapping" in result ? result.mapping : undefined,
      devices: "devices" in result ? result.devices : undefined,
    },
  };
}

r.post("/link-requests", requirePermission("users.update", "all"), async (req, res) => {
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

  if (result.ok === false) {
    const error = biometricLinkStartErrorResponse(result);
    return res.status(error.status).json(error.body);
  }

  return res.status(201).json({
    linkRequest: result.linkRequest,
    ttlSeconds: biometricLinkTtlSeconds(),
  });
});

r.post("/link-requests/:id/confirm", requirePermission("users.update", "all"), async (req, res) => {
  const userId = getUserId(req as any);
  const result = await confirmBiometricLinkRequest({
    userId,
    linkRequestId: req.params.id,
    req,
  });

  if (result.ok === false) {
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
  });
});

r.post("/link-requests/:id/cancel", requirePermission("users.update", "all"), async (req, res) => {
  const userId = getUserId(req as any);
  const result = await cancelBiometricLinkRequest({
    userId,
    linkRequestId: req.params.id,
    req,
  });

  if (result.ok === false) {
    return res.status(404).json({ message: "Solicitud no encontrada" });
  }

  return res.json({ message: "Vinculación cancelada" });
});

r.get("/admin/users/:userId/biometric", requirePermission("users.update", "all"), async (req, res) => {
  const userId = req.params.userId;
  const linkRequest = await getActiveBiometricLinkRequest(userId);
  const mapping = await getUserBiometricMapping(userId);
  return res.json({
    linkRequest,
    mapping,
    ttlSeconds: biometricLinkTtlSeconds(),
  });
});

r.delete("/admin/users/:userId/biometric/mapping", requirePermission("users.update", "all"), async (req, res) => {
  const result = await deactivateUserBiometricMapping(req.params.userId, req);
  if (result.ok === false) {
    return res.status(404).json({ message: "El usuario no tiene un lector vinculado" });
  }
  return res.json({ message: "Vínculo biométrico eliminado" });
});

r.post("/admin/users/:userId/biometric/link-requests", requirePermission("users.update", "all"), async (req, res) => {
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.errors });
  }

  const result = await createBiometricLinkRequest({
    userId: req.params.userId,
    deviceId: parsed.data.deviceId,
    deviceCode: parsed.data.deviceCode,
    actorIp: clientIpFromRequest(req),
    req,
  });

  if (result.ok === false) {
    const error = biometricLinkStartErrorResponse(result);
    return res.status(error.status).json(error.body);
  }

  return res.status(201).json({
    linkRequest: result.linkRequest,
    ttlSeconds: biometricLinkTtlSeconds(),
  });
});

r.post("/admin/users/:userId/biometric/link-requests/:id/confirm", requirePermission("users.update", "all"), async (req, res) => {
  const result = await confirmBiometricLinkRequest({
    userId: req.params.userId,
    linkRequestId: req.params.id,
    req,
  });

  if (result.ok === false) {
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
  });
});

r.post("/admin/users/:userId/biometric/link-requests/:id/cancel", requirePermission("users.update", "all"), async (req, res) => {
  const result = await cancelBiometricLinkRequest({
    userId: req.params.userId,
    linkRequestId: req.params.id,
    req,
  });

  if (result.ok === false) {
    return res.status(404).json({ message: "Solicitud no encontrada" });
  }

  return res.json({ message: "Vinculación cancelada" });
});

export default r;
