import { Router } from "express";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authGuard, requirePermission } from "../middlewares/auth.js";
import { prisma } from "../db/prisma.js";
import { utcDay } from "../services/non-working-days.js";

const r = Router();

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  date: dateOnlySchema,
  type: z.enum(["HOLIDAY", "NON_WORKING_DAY"]).default("NON_WORKING_DAY"),
  reason: z.string().min(1).max(160),
  notes: z.string().max(1000).optional().nullable(),
  schoolYearId: z.string().uuid().optional().nullable(),
});

function parseDateOnly(date: string) {
  return utcDay(new Date(`${date}T00:00:00.000Z`));
}

function serializeNonWorkingDay<T extends { date: Date }>(row: T) {
  return {
    ...row,
    date: row.date.toISOString().slice(0, 10),
  };
}

r.get("/", authGuard, requirePermission("licenses.read", "all"), async (req, res) => {
  try {
    const from = typeof req.query.from === "string" ? parseDateOnly(req.query.from) : new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const to = typeof req.query.to === "string" ? parseDateOnly(req.query.to) : new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31));
    const schoolYearId = typeof req.query.schoolYearId === "string" && req.query.schoolYearId ? req.query.schoolYearId : null;
    const schoolYearFilter = schoolYearId ? Prisma.sql`AND "schoolYearId" = ${schoolYearId}` : Prisma.empty;

    const rows = await prisma.$queryRaw<Array<{
      id: string;
      date: Date;
      type: string;
      reason: string;
      notes: string | null;
      schoolYearId: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>>(Prisma.sql`
      SELECT id, date, type, reason, notes, "schoolYearId", "createdAt", "updatedAt"
      FROM "NonWorkingDay"
      WHERE date >= ${from} AND date <= ${to} ${schoolYearFilter}
      ORDER BY date ASC
    `);

    res.json({ data: rows.map(serializeNonWorkingDay) });
  } catch (error) {
    console.error("[non-working-days GET]", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

r.post("/", authGuard, requirePermission("licenses.create", "all"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.errors });

  try {
    const day = parseDateOnly(parsed.data.date);
    const id = crypto.randomUUID();
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "NonWorkingDay" (id, date, type, reason, notes, "schoolYearId", "createdAt", "updatedAt")
      VALUES (
        ${id},
        ${day},
        ${parsed.data.type}::"NonWorkingDayType",
        ${parsed.data.reason.trim()},
        ${parsed.data.notes?.trim() || null},
        ${parsed.data.schoolYearId || null},
        now(),
        now()
      )
      ON CONFLICT (date) DO UPDATE SET
        type = EXCLUDED.type,
        reason = EXCLUDED.reason,
        notes = EXCLUDED.notes,
        "schoolYearId" = EXCLUDED."schoolYearId",
        "updatedAt" = now()
      RETURNING id
    `);
    res.status(201).json({ ok: true, id: rows[0]?.id });
  } catch (error) {
    console.error("[non-working-days POST]", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

r.delete("/:id", authGuard, requirePermission("licenses.delete", "all"), async (req, res) => {
  try {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "NonWorkingDay" WHERE id = ${req.params.id}`);
    res.json({ ok: true });
  } catch (error) {
    console.error("[non-working-days DELETE]", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

export default r;
