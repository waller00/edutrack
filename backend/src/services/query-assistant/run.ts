import { enrichPayloadFromQuestion } from './enrich-payload.js'
import { executeAbsencesSummary } from './absences.js'
import { executeAssignedEventsSummary } from './assigned-events.js'
import { executeAttendanceLateSummary } from './attendance-late.js'
import { executeAuditLogSummary } from './audit-summary.js'
import { executeBiometricIssuesSummary } from './biometric-issues.js'
import { executeHoursWorkedSummary } from './hours-worked.js'
import { executeAttendanceIncidentsSummary } from './incidents.js'
import { isQueryAssistantConfigErrorMessage } from './llm-client.js'
import { runNaturalLanguageSqlQuery } from './llm-sql.js'
import { parseQuestionWithLlm } from './llm-parse.js'
import { executeMedicalLeavesSummary } from './medical-leaves.js'
import { heuristicIntentFromQuestion } from './question-heuristics.js'
import type { LlmIntentPayload, QueryAssistantIntent, QueryAssistantTableResult } from './schemas.js'
import type { QueryAssistantScope } from './scope.js'
import { executeUsersAdminSnapshot } from './users-admin.js'

/**
 * Intents que la heurística local resuelve con precisión suficiente como para
 * saltear el LLM: cálculos con lógica curada en el servidor (horas efectivas)
 * o listados administrativos fijos. Solo se usa en modo `hybrid`; ahí el resto
 * de las preguntas va al traductor NL→SQL, que entiende sinónimos y fraseo libre
 * mucho mejor que las reglas por regex.
 *
 * ABSENCES_SUMMARY es fast-path por necesidad, no por ahorro: las faltas se
 * derivan de las ocurrencias planificadas (recurrencia expandida en TypeScript)
 * y pueden no existir como filas de "Attendance" hasta que un admin las
 * materializa, así que el traductor NL→SQL no puede calcularlas bien.
 */
const FAST_PATH_INTENTS: ReadonlySet<QueryAssistantIntent> = new Set([
  'HOURS_WORKED_SUMMARY',
  'USERS_ADMIN_SNAPSHOT',
  'ABSENCES_SUMMARY',
])

async function executeIntentPayload(
  parsed: LlmIntentPayload,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult | null> {
  switch (parsed.intent) {
    case 'HOURS_WORKED_SUMMARY':
      return executeHoursWorkedSummary(parsed, scope)
    case 'ABSENCES_SUMMARY':
      return executeAbsencesSummary(parsed, scope)
    case 'ATTENDANCE_INCIDENTS_SUMMARY':
      return executeAttendanceIncidentsSummary(parsed, scope)
    case 'MEDICAL_LEAVES_SUMMARY':
      return executeMedicalLeavesSummary(parsed)
    case 'ASSIGNED_EVENTS_SUMMARY':
      return executeAssignedEventsSummary(parsed, scope)
    case 'BIOMETRIC_ISSUES_SUMMARY':
      return executeBiometricIssuesSummary(parsed)
    case 'ATTENDANCE_LATE_SUMMARY':
      return executeAttendanceLateSummary(parsed, scope)
    case 'USERS_ADMIN_SNAPSHOT':
      return executeUsersAdminSnapshot(parsed)
    case 'AUDIT_LOG_SUMMARY':
      return executeAuditLogSummary(parsed)
    default:
      return null
  }
}

function unknownResult(parsed: LlmIntentPayload): QueryAssistantTableResult {
  return {
    intent: 'UNKNOWN',
    summary:
      parsed.reply ||
      'No puedo responder esa consulta con los informes disponibles. Probá: horas trabajadas, incidencias, licencias, eventos asignados, marcas biométricas, tardanzas, usuarios o auditoría.',
    columns: [],
    rows: [],
  }
}

/** Clasifica con heurística local (sin tokens) y ejecuta el informe curado si aplica. */
async function tryHeuristicReport(
  question: string,
  scope: QueryAssistantScope | undefined,
  allowed?: ReadonlySet<QueryAssistantIntent>,
): Promise<QueryAssistantTableResult | null> {
  const fast = heuristicIntentFromQuestion(question, scope?.schoolYearCode)
  if (!fast || (allowed && !allowed.has(fast.intent))) return null
  const enriched = enrichPayloadFromQuestion(fast, question, { defaultYear: scope?.schoolYearCode })
  return executeIntentPayload(enriched, scope)
}

function isLlmConfigError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return isQueryAssistantConfigErrorMessage(msg)
}

/** Modo legacy `intent`: clasificador (heurística + LLM) con informes prearmados, sin SQL libre. */
async function runIntentPipeline(
  question: string,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult> {
  const parsed = await parseQuestionWithLlm(question, { defaultYear: scope?.schoolYearCode })
  return (await executeIntentPayload(parsed, scope)) ?? unknownResult(parsed)
}

/**
 * Orquestación del asistente. El modo se elige con `QUERY_ASSISTANT_MODE`:
 *
 * - `intent` (**default**): clasificador + informes prearmados. El modelo nunca escribe
 *   SQL; solo devuelve una etiqueta y parámetros, y las consultas las ejecuta código
 *   curado. Es el modo seguro y por eso es el comportamiento por omisión.
 * - `sql`: solo el traductor NL→SQL.
 * - `hybrid`: heurística local para intents de alta precisión y luego NL→SQL, con
 *   informe prearmado de respaldo si el SQL falla.
 *
 * Los modos que dejan al modelo generar SQL son **opt-in explícito**: se ejecuta contra
 * la base con `$queryRawUnsafe`, así que un `.env` incompleto no debe habilitarlos por
 * accidente. Ver también el chequeo de base de solo lectura en `llm-sql.ts`.
 */
export async function runAdminQueryAssistant(
  question: string,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult> {
  const mode = process.env.QUERY_ASSISTANT_MODE?.trim() || 'intent'
  const trimmed = question.trim()
  if (mode !== 'sql' && mode !== 'hybrid') return runIntentPipeline(trimmed, scope)

  if (mode !== 'sql') {
    const fast = await tryHeuristicReport(trimmed, scope, FAST_PATH_INTENTS)
    if (fast) return fast
  }

  try {
    return await runNaturalLanguageSqlQuery(trimmed, scope)
  } catch (e) {
    if (mode === 'sql' || isLlmConfigError(e)) throw e
    console.warn('[query-assistant] NL→SQL falló; intento informe prearmado de respaldo', e)
    const fallback = await tryHeuristicReport(trimmed, scope)
    if (fallback) return fallback
    throw e
  }
}
