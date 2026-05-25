import { executeAssignedEventsSummary } from './assigned-events.js'
import { executeAttendanceLateSummary } from './attendance-late.js'
import { executeAuditLogSummary } from './audit-summary.js'
import { executeBiometricIssuesSummary } from './biometric-issues.js'
import { executeHoursWorkedSummary } from './hours-worked.js'
import { executeAttendanceIncidentsSummary } from './incidents.js'
import { runNaturalLanguageSqlQuery } from './llm-sql.js'
import { parseQuestionWithLlm } from './llm-parse.js'
import { executeMedicalLeavesSummary } from './medical-leaves.js'
import type { QueryAssistantTableResult } from './schemas.js'
import type { QueryAssistantScope } from './scope.js'
import { executeUsersAdminSnapshot } from './users-admin.js'

export async function runAdminQueryAssistant(
  question: string,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult> {
  if (process.env.QUERY_ASSISTANT_MODE === 'sql') {
    return runNaturalLanguageSqlQuery(question, scope)
  }

  const parsed = await parseQuestionWithLlm(question, { defaultYear: scope?.schoolYearCode })

  switch (parsed.intent) {
    case 'HOURS_WORKED_SUMMARY':
      return executeHoursWorkedSummary(parsed, scope)
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
    case 'UNKNOWN':
    default:
      if (process.env.QUERY_ASSISTANT_MODE !== 'intent') {
        try {
          return await runNaturalLanguageSqlQuery(question, scope)
        } catch (e) {
          console.warn('[query-assistant] SQL mode failed after unknown intent', e)
        }
      }
      return {
        intent: 'UNKNOWN',
        summary:
          parsed.reply ||
          'No puedo responder esa consulta con los informes disponibles. Probá: horas trabajadas, incidencias, licencias, eventos asignados, marcas biométricas, tardanzas, usuarios o auditoría.',
        columns: [],
        rows: [],
      }
  }
}
