import { Router } from "express";
import { z } from "zod";
import { authGuard, requirePermission } from "../middlewares/auth.js";
import { createSubstitution } from "../services/substitutions.js";

const r = Router();

const createSubstitutionSchema = z.object({
  eventId: z.string().uuid(),
  substituteUserId: z.string().uuid(),
  reason: z.string().min(1),
  notes: z.string().optional(),
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

export default r;
