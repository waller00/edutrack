import { z } from 'zod'

export const QUERY_ASSISTANT_INTENTS = [
  'HOURS_WORKED_SUMMARY',
  'ABSENCES_SUMMARY',
  'ATTENDANCE_INCIDENTS_SUMMARY',
  'MEDICAL_LEAVES_SUMMARY',
  'ASSIGNED_EVENTS_SUMMARY',
  'BIOMETRIC_ISSUES_SUMMARY',
  'ATTENDANCE_LATE_SUMMARY',
  'USERS_ADMIN_SNAPSHOT',
  'AUDIT_LOG_SUMMARY',
  'UNKNOWN',
] as const

export type QueryAssistantIntent = (typeof QUERY_ASSISTANT_INTENTS)[number]

/** Respuesta esperada del modelo (solo clasificación; no ejecuta consultas). */
export const llmIntentSchema = z.object({
  intent: z.enum(QUERY_ASSISTANT_INTENTS),
  params: z
    .object({
      year: z.number().int().min(2000).max(2100).optional(),
      month: z.number().int().min(1).max(12).optional(),
      /** Rango explícito YYYY-MM-DD (si el usuario dice "del 1 al 15 de mayo") */
      dateFrom: z.string().max(12).optional(),
      dateTo: z.string().max(12).optional(),
      userSearch: z.string().max(200).optional(),
      /** Incidencias: solo abiertas o todas */
      incidentStatusScope: z.enum(['OPEN_ONLY', 'ALL']).optional(),
      incidentTypeScope: z.enum(['LATE_ARRIVAL', 'TEACHER_NO_SHOW', 'EARLY_EXIT', 'ALL']).optional(),
      /** Incidencias/faltas: listado detallado (default) o conteo por persona (p. ej. «quién faltó más»). */
      incidentViewMode: z.enum(['LIST', 'COUNT_BY_USER']).optional(),
      /** Faltas: limitar a docentes o a funcionarios según cómo pregunta el usuario. */
      personRoleScope: z.enum(['TEACHER', 'STAFF']).optional(),
      /** Licencias: todas, solo vigentes/activas o solo inactivas (cerradas). */
      leaveStatusScope: z.enum(['ALL', 'ACTIVE_ONLY', 'INACTIVE_ONLY']).optional(),
      biometricIssueScope: z.enum(['FAILED', 'PENDING', 'BOTH']).optional(),
      /** Usuarios / cuentas (sin período obligatorio) */
      userAdminScope: z
        .enum(['PENDING_APPROVAL', 'INACTIVE', 'DOC_EXPIRING_90D', 'LOCKED', 'ACTIVE_RECENT'])
        .optional(),
      /** Subcadena para filtrar acciones de auditoría (código o palabra del label) */
      auditActionKeyword: z.string().max(80).optional(),
    })
    .strip(),
  reply: z.string().max(500),
})

export type LlmIntentPayload = z.infer<typeof llmIntentSchema>

export type QueryAssistantTableResult = {
  intent: string
  summary: string
  columns: { key: string; label: string }[]
  rows: Record<string, string | number | null>[]
}
