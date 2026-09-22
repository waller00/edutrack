import { describe, expect, it } from 'vitest'
import { isEmptyPlan, planEbiRemap, targetCodeFor, type RemapInput, type RemapPeriod } from './remap-ebi-plan.js'

const TRAMO = {
  kind: 'TRAMO' as const,
  requiresGeneralGrade: false,
  requiresConceptualJudgement: false,
  isMeeting: false,
  judgementLabel: null,
}

function period(id: string, code: string, overrides: Partial<RemapPeriod> = {}): RemapPeriod {
  return { id, code, isActive: true, ...TRAMO, ...overrides }
}

const EMPTY_ATTACHMENTS = {
  emptyOpenGradeBookPeriodIds: [],
  gradeBookPeriodsWithData: 0,
  meetingRecords: 0,
  conductRecords: 0,
  messages: 0,
}

function input(overrides: Partial<RemapInput> = {}): RemapInput {
  return {
    periods: [
      period('p-mayo', 'MAYO', { requiresGeneralGrade: true }),
      period('p-junjul', 'JUNIO_JULIO'),
      period('p-sem', 'EVALUACION_SEMESTRAL'),
      period('p-mayjun', 'MAYO_JUNIO'),
      period('p-jul', 'JULIO'),
    ],
    shapesByCode: { MAYO_JUNIO: TRAMO, JULIO: TRAMO },
    retiredCodes: ['MAYO', 'JUNIO_JULIO', 'EVALUACION_SEMESTRAL'],
    assessments: [],
    attachmentsByPeriodId: {},
    closedGradesMissingR: [],
    pruebaActivityTypeId: 'type-prueba',
    ...overrides,
  }
}

describe('targetCodeFor', () => {
  it('parte Junio‑Julio por el mes de la evaluación', () => {
    expect(targetCodeFor('JUNIO_JULIO', '2026-06-30')).toBe('MAYO_JUNIO')
    expect(targetCodeFor('JUNIO_JULIO', '2026-07-01')).toBe('JULIO')
  })

  it('manda Mayo a Mayo‑Junio y la evaluación semestral a Julio', () => {
    expect(targetCodeFor('MAYO', '2026-05-10')).toBe('MAYO_JUNIO')
    expect(targetCodeFor('EVALUACION_SEMESTRAL', '2026-07-20')).toBe('JULIO')
    expect(targetCodeFor('OTRO', '2026-07-20')).toBeNull()
  })
})

describe('planEbiRemap', () => {
  it('mueve las evaluaciones y da de baja los períodos retirados vacíos', () => {
    const plan = planEbiRemap(
      input({
        assessments: [
          { id: 'a-1', periodId: 'p-mayo', date: '2026-05-12', activityTypeId: 'type-oral' },
          { id: 'a-2', periodId: 'p-junjul', date: '2026-06-02', activityTypeId: null },
          { id: 'a-3', periodId: 'p-junjul', date: '2026-07-20', activityTypeId: null },
        ],
        attachmentsByPeriodId: { 'p-mayo': { ...EMPTY_ATTACHMENTS, emptyOpenGradeBookPeriodIds: ['gbp-1'] } },
      }),
    )
    expect(plan.assessmentMoves).toEqual([
      { assessmentId: 'a-1', toPeriodId: 'p-mayjun' },
      { assessmentId: 'a-2', toPeriodId: 'p-mayjun' },
      { assessmentId: 'a-3', toPeriodId: 'p-jul' },
    ])
    expect(plan.emptyGradeBookPeriodDeletes).toEqual(['gbp-1'])
    expect(plan.deactivate.map((d) => d.code)).toEqual(['MAYO', 'JUNIO_JULIO', 'EVALUACION_SEMESTRAL'])
    expect(plan.blocked).toEqual([])
  })

  it('la evaluación semestral sin tipo pasa a ser una Prueba', () => {
    const plan = planEbiRemap(
      input({
        assessments: [
          { id: 'a-1', periodId: 'p-sem', date: '2026-07-10', activityTypeId: null },
          { id: 'a-2', periodId: 'p-sem', date: '2026-07-11', activityTypeId: 'type-escrito' },
        ],
      }),
    )
    expect(plan.assessmentMoves).toEqual([
      { assessmentId: 'a-1', toPeriodId: 'p-jul', activityTypeId: 'type-prueba' },
      { assessmentId: 'a-2', toPeriodId: 'p-jul' },
    ])
  })

  it('un período retirado con cierre o notas no se toca: se informa entero', () => {
    const plan = planEbiRemap(
      input({
        assessments: [{ id: 'a-1', periodId: 'p-mayo', date: '2026-05-12', activityTypeId: null }],
        attachmentsByPeriodId: { 'p-mayo': { ...EMPTY_ATTACHMENTS, gradeBookPeriodsWithData: 2, meetingRecords: 1 } },
      }),
    )
    expect(plan.assessmentMoves).toEqual([])
    expect(plan.deactivate.map((d) => d.code)).not.toContain('MAYO')
    expect(plan.blocked).toEqual([
      { code: 'MAYO', reasons: ['2 libreta(s) con notas o cierre en el período', '1 decisión(es) de reunión'] },
    ])
  })

  it('sin período destino no mueve y deja el retirado activo', () => {
    const plan = planEbiRemap(
      input({
        periods: [period('p-mayo', 'MAYO')],
        assessments: [{ id: 'a-1', periodId: 'p-mayo', date: '2026-05-12', activityTypeId: null }],
      }),
    )
    expect(plan.unmovable).toEqual(['a-1'])
    expect(plan.blocked[0]).toMatchObject({ code: 'MAYO', reasons: ['1 evaluación(es) sin período destino'] })
  })

  it('impone la forma sembrada sólo donde difiere', () => {
    const entrega = { ...TRAMO, kind: 'ENTREGA' as const, isMeeting: true, requiresGeneralGrade: true }
    const plan = planEbiRemap(
      input({
        periods: [period('p-e1', 'ENTREGA_1'), period('p-mayjun', 'MAYO_JUNIO')],
        shapesByCode: { ENTREGA_1: entrega, MAYO_JUNIO: TRAMO },
      }),
    )
    expect(plan.shapeUpdates).toEqual([{ periodId: 'p-e1', code: 'ENTREGA_1', data: entrega }])
  })

  it('completa R desde C en los períodos cerrados y es idempotente', () => {
    const first = planEbiRemap(input({ closedGradesMissingR: [{ id: 'pg-1', valueHundredths: 700 }] }))
    expect(first.backfillMeetingGrades).toEqual([{ id: 'pg-1', valueHundredths: 700 }])

    const applied = planEbiRemap(
      input({
        periods: input().periods.map((p) => (p.code === 'MAYO_JUNIO' || p.code === 'JULIO' ? p : { ...p, isActive: false })),
      }),
    )
    expect(isEmptyPlan(applied)).toBe(true)
  })
})
