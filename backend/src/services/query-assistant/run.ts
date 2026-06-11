import { enrichPayloadFromQuestion } from './enrich-payload.js'
import { executeAbsencesSummary } from './absences.js'
import { executeAssignedEventsSummary } from './assigned-events.js'
import { executeAttendanceLateSummary } from './attendance-late.js'
import { executeAuditLogSummary } from './audit-summary.js'
import { executeBiometricIssuesSummary } from './biometric-issues.js'
import { executeHoursWorkedSummary } from './hours-worked.js'
import { executeAttendanceIncidentsSummary } from './incidents.js'
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
 * o listados administrativos fijos. El resto de las preguntas va directo al
 * traductor NL→SQL, que entiende sinónimos y fraseo libre mucho mejor que las
 * reglas por regex.
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

function isOpenAiConfigError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return msg === 'OPENAI_API_KEY_NOT_CONFIGURED' || msg.startsWith('OPENAI_API_KEY_INVALID_FORMAT:')
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
 * Orquestación por defecto (SQL-first):
 * 1. Heurística local solo para intents de alta precisión (cero tokens).
 * 2. Traductor NL→SQL con esquema + sinónimos (una llamada, prefijo cacheable).
 * 3. Si el SQL falla por causas ajenas a la configuración, informe heurístico de respaldo.
 *
 * `QUERY_ASSISTANT_MODE=sql` fuerza solo SQL; `intent` mantiene el pipeline clásico.
 */
export async function runAdminQueryAssistant(
  question: string,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult> {
  const mode = process.env.QUERY_ASSISTANT_MODE
  const trimmed = question.trim()
  if (mode === 'intent') return runIntentPipeline(trimmed, scope)

  if (mode !== 'sql') {
    const fast = await tryHeuristicReport(trimmed, scope, FAST_PATH_INTENTS)
    if (fast) return fast
  }

  try {
    return await runNaturalLanguageSqlQuery(trimmed, scope)
  } catch (e) {
    if (mode === 'sql' || isOpenAiConfigError(e)) throw e
    console.warn('[query-assistant] NL→SQL falló; intento informe prearmado de respaldo', e)
    const fallback = await tryHeuristicReport(trimmed, scope)
    if (fallback) return fallback
    throw e
  }
}
