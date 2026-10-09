import { Router } from "express";
import { z } from "zod";
import { authGuard } from "../middlewares/auth.js";
import { prisma } from "../db/prisma.js";

const r = Router();

/**
 * Cursor de la lista: fecha y id del último aviso que vio el cliente ("fecha|id"). El id desempata
 * los avisos creados en el mismo instante, como los de un mismo `createMany`.
 */
type Cursor = { createdAt: Date; id: string };

export function encodeCursor(item: { createdAt: Date; id: string }): string {
  return `${item.createdAt.toISOString()}|${item.id}`;
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  const [iso, id] = value.split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

const listQuerySchema = z.object({
  unreadOnly: z.enum(["true", "false"]).optional(),
  take: z.coerce.number().int().min(1).max(100).optional().default(50),
  /** Cursor de "Cargar más": avisos anteriores a éste. */
  before: z.string().max(200).optional(),
});

const summaryQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(20).optional().default(8),
});

const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

function userIdOf(req: unknown): string | undefined {
  return (req as { user?: { id?: string } }).user?.id;
}

r.get("/", authGuard, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.errors });
    }

    const { unreadOnly, take, before } = parsed.data;
    const cursor = decodeCursor(before);
    if (before && !cursor) return res.status(400).json({ message: "Cursor inválido" });

    const rows = await prisma.inAppNotification.findMany({
      where: {
        userId,
        ...(unreadOnly === "true" ? { readAt: null } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: NEWEST_FIRST,
      // Uno de más para saber si hay otra página sin contar todo.
      take: take + 1,
    });
    const items = rows.slice(0, take);
    const nextCursor = rows.length > take ? encodeCursor(items[items.length - 1]) : null;
    res.json({ items, nextCursor });
  } catch (e) {
    console.error("in-app notifications list:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

/**
 * Lo que necesita la campana en una sola consulta: cuántos avisos sin leer hay y los últimos. Es
 * lo que el cliente pide cada minuto, así que no pagina ni filtra.
 */
r.get("/summary", authGuard, async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ message: "No autorizado" });

    const parsed = summaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.errors });
    }

    const [unreadCount, items] = await Promise.all([
      prisma.inAppNotification.count({ where: { userId, readAt: null } }),
      prisma.inAppNotification.findMany({ where: { userId }, orderBy: NEWEST_FIRST, take: parsed.data.take }),
    ]);
    res.json({ unreadCount, items });
  } catch (e) {
    console.error("in-app notifications summary:", e);
    res.status(500).json({ message: "Error interno" });
  }
});

r.get("/unread-count", authGuard, async (req, res) => {
  try {
    const userId = userIdOf(req);
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
    const userId = userIdOf(req);
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
    const userId = userIdOf(req);
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
