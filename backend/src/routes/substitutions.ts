import { Router } from "express";
import { z } from "zod";
import { authGuard, requirePermission } from "../middlewares/auth.js";
import {
  createSubstitution,
  deleteSubstitution,
  listSubstitutions,
} from "../services/substitutions.js";

const r = Router();

const createSubstitutionSchema = z.object({
  eventId: z.string().uuid(),
  substituteUserId: z.string().uuid(),
  reason: z.string().min(1),
  notes: z.string().optional(),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const listSubstitutionSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  eventId: z.string().uuid().optional(),
  originalTeacherUserId: z.string().uuid().optional(),
  substituteUserId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

r.get("/", authGuard, requirePermission("events.read", "all"), async (req, res) => {
  try {
    const parsed = listSubstitutionSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Parámetros inválidos", errors: parsed.error.errors });
    }
    const body = await listSubstitutions(parsed.data);
    return res.json(body);
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({
      message: error?.message || "Error interno del servidor",
      code: error?.code,
    });
  }
});

r.post("/", authGuard, requirePermission("events.update", "all"), async (req, res) => {
  try {
    const parsed = createSubstitutionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.errors });
    }

    const substitution = await createSubstitution({
      eventId: parsed.data.eventId,
      substituteUserId: parsed.data.substituteUserId,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
      occurrenceDate: parsed.data.occurrenceDate,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
    });

    return res.status(201).json({ substitution, message: "Suplencia registrada correctamente" });
  } catch (error: any) {
    console.error("Error registrando suplencia:", error);
    return res.status(error?.statusCode || 500).json({
      message: error?.message || "Error interno del servidor",
      code: error?.code,
    });
  }
});

r.delete("/:id", authGuard, requirePermission("events.update", "all"), async (req, res) => {
  try {
    const result = await deleteSubstitution({
      id: req.params.id,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
    });
    return res.json({ ...result, message: "Suplencia eliminada" });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({
      message: error?.message || "Error interno del servidor",
      code: error?.code,
    });
  }
});

export default r;
