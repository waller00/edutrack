import type { Request } from "express";
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@prisma/client";
import { prisma } from "../db/prisma.js";

const UA_MAX = 512;

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  AUTH_LOGIN_SUCCESS: "Inicio de sesión (email/contraseña)",
  AUTH_LOGIN_FAILURE: "Intento de inicio de sesión fallido",
  AUTH_LOGOUT: "Cierre de sesión",
  AUTH_GOOGLE_LOGIN_SUCCESS: "Inicio de sesión con Google",
  USER_CREATED_BY_ADMIN: "Usuario creado por administración",
  USER_UPDATED_BY_ADMIN: "Usuario actualizado por administración",
  USER_DELETED_BY_ADMIN: "Usuario eliminado por administración",
  USER_ACCOUNT_LOCK_TOGGLED: "Bloqueo o desbloqueo de cuenta",
  ADMIN_PASSWORD_RESET_ISSUED: "Token de restablecimiento de contraseña emitido",
  MEDICAL_LEAVE_CREATED: "Licencia / permiso registrado",
  MEDICAL_LEAVE_UPDATED: "Licencia / permiso actualizado",
  MEDICAL_LEAVE_DEACTIVATED: "Licencia / permiso desactivado",
  SYSTEM_SETTINGS_UPDATED: "Parámetros del sistema actualizados",
  EVENT_CREATED: "Evento creado",
  BIOMETRIC_LINK_STARTED: "Vinculación biométrica iniciada",
  BIOMETRIC_LINK_DETECTED: "Marca detectada para vinculación biométrica",
  BIOMETRIC_LINK_CONFIRMED: "Vinculación biométrica confirmada",
  BIOMETRIC_LINK_CANCELLED: "Vinculación biométrica cancelada",
  BIOMETRIC_MAPPING_REMOVED: "Vínculo biométrico eliminado",
  ATTENDANCE_MANUAL_UPDATED: "Asistencia modificada manualmente",
  ATTENDANCE_JUSTIFIED: "Asistencia justificada",
  ATTENDANCE_INCIDENT_RESOLVED: "Incidente de asistencia resuelto",
  SUBSTITUTION_CREATED: "Suplencia registrada",
  MOODLE_GRADES_PUSHED: "Notas empujadas a Moodle",
  // Compatibilidad con registros históricos del módulo retirado.
  QUERY_ASSISTANT_QUERY_EXECUTED: "Consulta del asistente ejecutada (histórico)",
  STUDENT_ROLL_CALL_TAKEN: "Pase de lista tomado",
  STUDENT_ROLL_CALL_UPDATED: "Pase de lista modificado",
  STUDENT_ROLL_CALL_DELETED: "Pase de lista eliminado",
  STUDENT_ROLL_CALL_REOPENED: "Pase de lista reabierto",
  STUDENT_ATTENDANCE_JUSTIFIED: "Falta de estudiante justificada",
  ACADEMIC_CONFIG_CREATED: "Configuración académica creada",
  ACADEMIC_CONFIG_UPDATED: "Configuración académica actualizada",
  ACADEMIC_CONFIG_DEACTIVATED: "Configuración académica desactivada",
  ASSESSMENT_CREATED: "Evaluación creada",
  ASSESSMENT_UPDATED: "Evaluación actualizada",
  ASSESSMENT_DELETED: "Evaluación dada de baja",
  GRADE_ENTERED: "Calificación registrada",
  GRADE_UPDATED: "Calificación modificada",
  GRADE_PERIOD_CLOSED: "Período de libreta cerrado",
  GRADE_PERIOD_REOPENED: "Período de libreta reabierto",
  MOODLE_GRADES_IMPORTED: "Notas importadas desde Moodle",
  GRADEBOOK_OBSERVED: "Libreta observada",
  GRADEBOOK_ENDORSED: "Libreta visada",
};

export function parseAuditActionFilter(raw: string | undefined): AuditAction | undefined {
  if (!raw) return undefined;
  return (Object.values(AuditAction) as string[]).includes(raw) ? (raw as AuditAction) : undefined;
}

export function getAuditActionCatalog(): { code: AuditAction; label: string }[] {
  return Object.keys(AUDIT_ACTION_LABELS).map((code) => ({
    code: code as AuditAction,
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

function buildAuditCreateData(input: RecordAuditEventInput) {
  const ip = input.actorIp ?? (input.req ? clientIpFromRequest(input.req) : undefined);
  const ua = truncateUa(
    input.userAgent ?? (input.req?.headers["user-agent"] ? String(input.req.headers["user-agent"]) : undefined),
  );

  return {
    action: input.action,
    actorUserId: input.actorUserId || null,
    actorIp: ip || null,
    userAgent: ua || null,
    source: input.source ?? "API",
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

/**
 * Inserta un evento de auditoría de forma asíncrona. No debe fallar la petición principal si el log falla.
 */
export function recordAuditEvent(input: RecordAuditEventInput): void {
  void (async () => {
    try {
      await prisma.auditLog.create({
        data: buildAuditCreateData(input),
      });
    } catch (e) {
      console.error("[audit-log] recordAuditEvent:", e);
    }
  })();
}

/**
 * Inserta auditoría dentro del flujo principal. Úselo cuando la regla de negocio exige trazabilidad garantizada.
 */
export async function recordAuditEventNow(input: RecordAuditEventInput): Promise<void> {
  const data = buildAuditCreateData(input);
  const metadataJson = data.metadata === undefined ? null : JSON.stringify(data.metadata);
  await prisma.$executeRaw`
    INSERT INTO "AuditLog"
      ("id", "action", "actorUserId", "actorIp", "userAgent", "source", "entityType", "entityId", "metadata")
    VALUES
      (
        ${crypto.randomUUID()},
        ${data.action}::"AuditAction",
        ${data.actorUserId},
        ${data.actorIp},
        ${data.userAgent},
        ${data.source},
        ${data.entityType},
        ${data.entityId},
        ${metadataJson}::jsonb
      )
  `;
}
