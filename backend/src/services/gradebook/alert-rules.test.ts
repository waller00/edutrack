import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { academicAlertRule: { findMany: vi.fn() } },
}))
vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))

import { alertRulesForYear, alertSubjectsThreshold, loadAlertRules, resolveAlertRules } from './alert-rules.js'

const rule = (type: string, schoolYearId: string | null, threshold: number, isActive = true) => ({
  type,
  schoolYearId,
  threshold,
  isActive,
})

describe('reglas de alerta vigentes (RF-200)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sin reglas cargadas rige el valor por defecto: 3 asignaturas, las otras apagadas', () => {
    expect(resolveAlertRules([], 'sy-2026')).toEqual([
      { type: 'ALERT_SUBJECTS', threshold: 3, isActive: true, source: 'DEFAULT' },
      { type: 'SCORE_DROP', threshold: 200, isActive: false, source: 'DEFAULT' },
      { type: 'NO_ASSESSMENTS', threshold: 0, isActive: false, source: 'DEFAULT' },
    ])
  })

  it('la regla del ciclo pisa a la general', () => {
    // Una comparativa histórica no puede cambiar sola cuando alguien mueve el umbral actual.
    const rules = resolveAlertRules(
      [rule('ALERT_SUBJECTS', null, 3), rule('ALERT_SUBJECTS', 'sy-2026', 2)],
      'sy-2026',
    )
    expect(rules[0]).toEqual({ type: 'ALERT_SUBJECTS', threshold: 2, isActive: true, source: 'YEAR' })
  })

  it('sin regla propia usa la general', () => {
    const rules = resolveAlertRules([rule('ALERT_SUBJECTS', null, 4)], 'sy-2025')
    expect(rules[0]).toMatchObject({ threshold: 4, source: 'GENERAL' })
  })

  it('apagar la regla en un ciclo no deja que se cuele la general', async () => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      rule('ALERT_SUBJECTS', null, 3),
      rule('ALERT_SUBJECTS', 'sy-2026', 3, false),
    ])
    const active = await alertRulesForYear('sy-2026')
    expect(active.find((r) => r.type === 'ALERT_SUBJECTS')).toBeUndefined()
    expect(alertSubjectsThreshold(active)).toBe(Number.POSITIVE_INFINITY)
  })

  it('consulta las del ciclo y las generales', async () => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([])
    await loadAlertRules('sy-2026')
    expect(prismaMock.academicAlertRule.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ schoolYearId: 'sy-2026' }, { schoolYearId: null }],
    })
  })

  it('el umbral de asignaturas sale de la regla activa', async () => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([rule('ALERT_SUBJECTS', null, 2)])
    expect(alertSubjectsThreshold(await alertRulesForYear('sy-2026'))).toBe(2)
  })
})
