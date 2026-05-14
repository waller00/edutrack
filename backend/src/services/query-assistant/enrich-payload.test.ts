import { describe, it, expect } from 'vitest'
import { enrichPayloadFromQuestion } from './enrich-payload.js'

describe('enrichPayloadFromQuestion', () => {
  it('añade leaveStatusScope ACTIVE con palabra activas', () => {
    const r = enrichPayloadFromQuestion(
      {
        intent: 'MEDICAL_LEAVES_SUMMARY',
        params: { month: 4, year: 2026 },
        reply: 'ok',
      },
      'Mostrame licencias activas en abril',
    )
    expect(r.params.leaveStatusScope).toBe('ACTIVE_ONLY')
  })

  it('añade COUNT_BY_USER + TEACHER_NO_SHOW desde la pregunta', () => {
    const r = enrichPayloadFromQuestion(
      {
        intent: 'ATTENDANCE_INCIDENTS_SUMMARY',
        params: { month: 3, year: 2026 },
        reply: 'ok',
      },
      'Ranking por persona de ausencias en marzo',
    )
    expect(r.params.incidentViewMode).toBe('COUNT_BY_USER')
    expect(r.params.incidentTypeScope).toBe('TEACHER_NO_SHOW')
  })

  it('extrae userSearch desde "docente Ana"', () => {
    const r = enrichPayloadFromQuestion(
      {
        intent: 'ATTENDANCE_LATE_SUMMARY',
        params: { month: 8, year: 2026 },
        reply: 'ok',
      },
      'Tardanzas docente Ana en agosto',
    )
    expect(r.params.userSearch).toBe('ana')
  })

  it('multi-palabra: Horas de Laura Rodríguez en abril', () => {
    const r = enrichPayloadFromQuestion(
      {
        intent: 'HOURS_WORKED_SUMMARY',
        params: { month: 4, year: 2026 },
        reply: 'ok',
      },
      'Horas de Laura Rodríguez en abril',
    )
    expect(r.params.userSearch).toMatch(/laura/i)
    expect(r.params.userSearch).toMatch(/rodriguez/i)
  })

  it('salida anticipada → EARLY_EXIT', () => {
    const r = enrichPayloadFromQuestion(
      {
        intent: 'ATTENDANCE_INCIDENTS_SUMMARY',
        params: { month: 7, year: 2026 },
        reply: 'ok',
      },
      'Incidencias de salida anticipada en julio',
    )
    expect(r.params.incidentTypeScope).toBe('EARLY_EXIT')
  })
})
