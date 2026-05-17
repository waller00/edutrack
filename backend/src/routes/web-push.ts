import { Router } from "express";
import { z } from "zod";
import { authGuard } from "../middlewares/auth.js";
import { prisma } from "../db/prisma.js";
import {
  getVapidPublicKey,
  isWebPushConfigured,
  sendWebPushPayloadToUser,
} from "../services/webPush.js";

const r = Router();

r.get("/vapid-public-key", (_req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({ message: "Push web no configurado (VAPID) en el servidor." });
  }
  res.json({ publicKey });
});

r.get("/status", authGuard, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });
    const count = await prisma.webPushSubscription.count({ where: { userId } });
    res.json({ configured: isWebPushConfigured(), subscriptionCount: count });
  } catch (e) {
    console.error("web-push status:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    expirationTime: z.union([z.number(), z.null()]).optional(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
  userAgent: z.string().max(500).optional(),
});

r.post("/subscribe", authGuard, async (req, res) => {
  try {
    if (!isWebPushConfigured()) {
      return res.status(503).json({ message: "Push web no configurado (VAPID) en el servidor." });
    }
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Suscripción inválida",
        errors: parsed.error.errors,
      });
    }

    const { subscription, userAgent } = parsed.data;
    const { endpoint, keys } = subscription;

    await prisma.webPushSubscription.upsert({
      where: { endpoint },
      create: {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent?.trim() || null,
      },
      update: {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent?.trim() || null,
      },
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("web-push subscribe:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

const unsubscribeBodySchema = z.object({
  endpoint: z.string().url().optional(),
});

r.delete("/subscribe", authGuard, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const parsed = unsubscribeBodySchema.safeParse(req.body ?? {});
    const endpoint = parsed.success ? parsed.data.endpoint : undefined;

    if (endpoint) {
      await prisma.webPushSubscription.deleteMany({ where: { userId, endpoint } });
    } else {
      await prisma.webPushSubscription.deleteMany({ where: { userId } });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("web-push unsubscribe:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

r.post("/test", authGuard, async (req, res) => {
  try {
    if (!isWebPushConfigured()) {
      return res.status(503).json({ message: "Push web no configurado (VAPID) en el servidor." });
    }
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const result = await sendWebPushPayloadToUser(userId, {
      title: "Edutrack",
      body: "Notificación de prueba. Si ves esto, las notificaciones push web están funcionando.",
      url: "/profile",
    });

    res.json({ ok: true, ...result });
  } catch (e) {
    console.error("web-push test:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

export default r;
