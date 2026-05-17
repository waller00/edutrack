import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@prisma/client";
import { prisma } from "../db/prisma.js";

const UA_MAX = 512;

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  AUTH_LOGIN_SUCCESS: "Inicio de sesión (email/contraseña)",
  AUTH_LOGIN_FAILURE: "Intento de inicio de sesión fallido",
  AUTH_LOGOUT: "Cierre de sesión",
  AUTH_GOOGLE_LOGIN_SUCCESS: "Inicio de sesión con Google",
  USER_CREATED_BY_ADMIN: "Usuario creado por administración",
  USER_UPDATED_BY_ADMIN: "Usuario actualizado por administración",
  USER_ACCOUNT_LOCK_TOGGLED: "Bloqueo o desbloqueo de cuenta",
  ADMIN_PASSWORD_RESET_ISSUED: "Token de restablecimiento de contraseña emitido",
  MEDICAL_LEAVE_CREATED: "Licencia / permiso registrado",
  MEDICAL_LEAVE_UPDATED: "Licencia / permiso actualizado",
  MEDICAL_LEAVE_DEACTIVATED: "Licencia / permiso desactivado",
  SYSTEM_SETTINGS_UPDATED: "Parámetros del sistema actualizados",
  EVENT_CREATED: "Evento creado",
};

export function parseAuditActionFilter(raw: string | undefined): AuditAction | undefined {
  if (!raw) return undefined;
  return (Object.values(AuditAction) as string[]).includes(raw) ? (raw as AuditAction) : undefined;
}

export function getAuditActionCatalog(): { code: AuditAction; label: string }[] {
  return (Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((code) => ({
    code,
    label: AUDIT_ACTION_LABELS[code],
  }));
}

function truncateUa(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  const t = ua.trim();
  if (t.length <= UA_MAX) return t;
  return `${t.slice(0, UA_MAX - 1)}…`;
}

/** IP del cliente detrás de proxy (trust proxy ya seteado en Express). */
export function clientIpFromRequest(req: Pick<Request, "headers" | "ip">): string | undefined {
  const fwd = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  if (fwd) return fwd.slice(0, 45);
  const ip = req.ip;
  if (ip) return String(ip).replace("::ffff:", "").slice(0, 45);
  return undefined;
}

export type RecordAuditEventInput = {
  action: AuditAction;
  actorUserId?: string | null;
  req?: Request;
  actorIp?: string | null;
  userAgent?: string | null;
  source?: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Inserta un evento de auditoría de forma asíncrona. No debe fallar la petición principal si el log falla.
 */
export function recordAuditEvent(input: RecordAuditEventInput): void {
  const ip = input.actorIp ?? (input.req ? clientIpFromRequest(input.req) : undefined);
  const ua = truncateUa(
    input.userAgent ?? (input.req?.headers["user-agent"] ? String(input.req.headers["user-agent"]) : undefined),
  );

  void (async () => {
    try {
      await prisma.auditLog.create({
        data: {
          action: input.action,
          actorUserId: input.actorUserId || null,
          actorIp: ip || null,
          userAgent: ua || null,
          source: input.source ?? "API",
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (e) {
      console.error("[audit-log] recordAuditEvent:", e);
    }
  })();
}
