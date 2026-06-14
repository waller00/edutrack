import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hours: vi.fn(),
  users: vi.fn(),
  incidents: vi.fn(),
  audit: vi.fn(),
  absences: vi.fn(),
  sql: vi.fn(),
  parse: vi.fn(),
}))

vi.mock('./hours-worked.js', () => ({ executeHoursWorkedSummary: mocks.hours }))
vi.mock('./absences.js', () => ({ executeAbsencesSummary: mocks.absences }))
vi.mock('./users-admin.js', () => ({ executeUsersAdminSnapshot: mocks.users }))
vi.mock('./incidents.js', () => ({ executeAttendanceIncidentsSummary: mocks.incidents }))
vi.mock('./audit-summary.js', () => ({ executeAuditLogSummary: mocks.audit }))
vi.mock('./assigned-events.js', () => ({ executeAssignedEventsSummary: vi.fn() }))
vi.mock('./attendance-late.js', () => ({ executeAttendanceLateSummary: vi.fn() }))
vi.mock('./biometric-issues.js', () => ({ executeBiometricIssuesSummary: vi.fn() }))
vi.mock('./medical-leaves.js', () => ({ executeMedicalLeavesSummary: vi.fn() }))
vi.mock('./llm-sql.js', () => ({ runNaturalLanguageSqlQuery: mocks.sql }))
vi.mock('./llm-parse.js', () => ({ parseQuestionWithLlm: mocks.parse }))

import { runAdminQueryAssistant } from './run.js'

const ORIGINAL_MODE = process.env.QUERY_ASSISTANT_MODE

function tableResult(intent: string) {
  return { intent, summary: 'ok', columns: [], rows: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.QUERY_ASSISTANT_MODE
})

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.QUERY_ASSISTANT_MODE
  else process.env.QUERY_ASSISTANT_MODE = ORIGINAL_MODE
})

describe('runAdminQueryAssistant — orquestación SQL-first', () => {
  it('"horas trabajadas mayo" usa el informe curado sin llamar al LLM', async () => {
    mocks.hours.mockResolvedValue(tableResult('HOURS_WORKED_SUMMARY'))

    const r = await runAdminQueryAssistant('horas trabajadas mayo', { schoolYearCode: 2026 })

    expect(r.intent).toBe('HOURS_WORKED_SUMMARY')
    expect(mocks.sql).not.toHaveBeenCalled()
    expect(mocks.parse).not.toHaveBeenCalled()
  })

  it('las preguntas libres van directo al traductor NL→SQL', async () => {
    mocks.sql.mockResolvedValue(tableResult('SQL_QUERY'))

    const r = await runAdminQueryAssistant('¿qué asignaturas tienen más eventos en junio?', {
      schoolYearId: 'sy-1',
      schoolYearCode: 2026,
    })

    expect(r.intent).toBe('SQL_QUERY')
    expect(mocks.sql).toHaveBeenCalledWith('¿qué asignaturas tienen más eventos en junio?', {
      schoolYearId: 'sy-1',
      schoolYearCode: 2026,
    })
    expect(mocks.parse).not.toHaveBeenCalled()
    expect(mocks.incidents).not.toHaveBeenCalled()
  })

  it('"¿qué profesores faltaron en junio?" usa el informe derivado de faltas, no SQL', async () => {
    mocks.absences.mockResolvedValue(tableResult('ABSENCES_SUMMARY'))

    const r = await runAdminQueryAssistant('¿qué profesores faltaron en junio?', {
      schoolYearId: 'sy-1',
      schoolYearCode: 2026,
    })

    expect(r.intent).toBe('ABSENCES_SUMMARY')
    expect(mocks.absences).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'ABSENCES_SUMMARY',
        params: expect.objectContaining({ month: 6, personRoleScope: 'TEACHER' }),
      }),
      { schoolYearId: 'sy-1', schoolYearCode: 2026 },
    )
    expect(mocks.sql).not.toHaveBeenCalled()
    expect(mocks.parse).not.toHaveBeenCalled()
  })

  it('si el SQL falla por causas ajenas a la configuración, cae al informe heurístico', async () => {
    mocks.sql.mockRejectedValue(new Error('OpenAI API (500): boom'))
    mocks.incidents.mockResolvedValue(tableResult('ATTENDANCE_INCIDENTS_SUMMARY'))

    const r = await runAdminQueryAssistant('incidencias abiertas en mayo', { schoolYearCode: 2026 })

    expect(r.intent).toBe('ATTENDANCE_INCIDENTS_SUMMARY')
  })

  it('los errores de configuración se propagan sin fallback (la ruta responde 503)', async () => {
    mocks.sql.mockRejectedValue(new Error('OPENAI_API_KEY_NOT_CONFIGURED'))

    await expect(runAdminQueryAssistant('incidencias abiertas en mayo')).rejects.toThrow(
      'OPENAI_API_KEY_NOT_CONFIGURED',
    )
    expect(mocks.incidents).not.toHaveBeenCalled()
  })

  it('QUERY_ASSISTANT_MODE=sql fuerza solo SQL y propaga errores', async () => {
    process.env.QUERY_ASSISTANT_MODE = 'sql'
    mocks.sql.mockRejectedValue(new Error('falló'))

    await expect(runAdminQueryAssistant('horas trabajadas mayo')).rejects.toThrow('falló')
    expect(mocks.hours).not.toHaveBeenCalled()
  })

  it('QUERY_ASSISTANT_MODE=intent usa el clasificador clásico', async () => {
    process.env.QUERY_ASSISTANT_MODE = 'intent'
    mocks.parse.mockResolvedValue({ intent: 'AUDIT_LOG_SUMMARY', params: { month: 5, year: 2026 }, reply: 'ok' })
    mocks.audit.mockResolvedValue(tableResult('AUDIT_LOG_SUMMARY'))

    const r = await runAdminQueryAssistant('auditoría de mayo', { schoolYearCode: 2026 })

    expect(r.intent).toBe('AUDIT_LOG_SUMMARY')
    expect(mocks.sql).not.toHaveBeenCalled()
  })
})
