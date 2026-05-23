import { Router } from "express";
import { z } from "zod";
import { authGuard } from "../middlewares/auth.js";
import { prisma } from "../db/prisma.js";

const r = Router();

const listQuerySchema = z.object({
  unreadOnly: z.enum(["true", "false"]).optional(),
  take: z.coerce.number().int().min(1).max(100).optional().default(50),
});

r.get("/", authGuard, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.errors });
    }

    const { unreadOnly, take } = parsed.data;
    const items = await prisma.inAppNotification.findMany({
      where: {
        userId,
        ...(unreadOnly === "true" ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    res.json({ items });
  } catch (e) {
    console.error("in-app notifications list:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

r.get("/unread-count", authGuard, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const count = await prisma.inAppNotification.count({
      where: { userId, readAt: null },
    });
    res.json({ count });
  } catch (e) {
    console.error("in-app notifications unread-count:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

r.patch("/:id/read", authGuard, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const { id } = req.params;
    const existing = await prisma.inAppNotification.findFirst({
      where: { id, userId },
    });
    if (!existing) return res.status(404).json({ message: "Aviso no encontrado" });

    const updated = await prisma.inAppNotification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    res.json(updated);
  } catch (e) {
    console.error("in-app notifications read:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

r.post("/read-all", authGuard, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const result = await prisma.inAppNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (e) {
    console.error("in-app notifications read-all:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

export default r;
