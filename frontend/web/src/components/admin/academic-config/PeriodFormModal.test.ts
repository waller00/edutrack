import { describe, expect, it } from 'vitest'
import { draftFromPeriod, periodPayload, validatePeriod, type PeriodDraft } from './PeriodFormModal'
import type { AcademicPeriod } from '@/lib/academic-config/types'

const PERIOD: AcademicPeriod = {
  id: 'p-1', schoolYearId: 'sy-1', level: 'EBI', code: 'MAYO', name: 'Mayo', sortOrder: 2,
  startsOn: '2026-05-01', endsOn: '2026-05-31', closesOn: '2026-06-08',
  requiresConceptualJudgement: true, requiresGeneralGrade: true, isActive: true,
  usage: { assessments: 3, closedGradeBooks: 1 },
}

function draft(over: Partial<PeriodDraft> = {}): PeriodDraft {
  return { ...draftFromPeriod(PERIOD, 'EBI'), ...over }
}

describe('draftFromPeriod', () => {
  it('sin período usa el nivel de la sección y exige calificación por defecto', () => {
    const d = draftFromPeriod(null, 'EMS')
    expect(d.level).toBe('EMS')
    expect(d.code).toBe('')
    expect(d.requiresGeneralGrade).toBe(true)
    expect(d.requiresConceptualJudgement).toBe(false)
  })

  it('las fechas nulas entran como cadena vacía, no como "null"', () => {
    const d = draftFromPeriod({ ...PERIOD, startsOn: null, closesOn: null }, 'EBI')
    expect(d.startsOn).toBe('')
    expect(d.closesOn).toBe('')
    expect(d.endsOn).toBe('2026-05-31')
  })
})

describe('validatePeriod', () => {
  it('acepta un período bien formado', () => {
    expect(validatePeriod(draft(), false)).toBeNull()
  })

  it('exige código con formato sólo al crear', () => {
    expect(validatePeriod(draft({ code: 'mayo 1' }), false)).toMatch(/código/i)
    expect(validatePeriod(draft({ code: 'mayo 1' }), true)).toBeNull()
  })

  it('exige nombre', () => {
    expect(validatePeriod(draft({ name: '   ' }), false)).toMatch(/nombre/i)
  })

  it('rechaza una ventana invertida', () => {
    expect(validatePeriod(draft({ startsOn: '2026-05-31', endsOn: '2026-05-01' }), false))
      .toMatch(/termina antes de empezar/i)
  })

  it('rechaza un cierre anterior al fin del período', () => {
    expect(validatePeriod(draft({ closesOn: '2026-05-15' }), false)).toMatch(/cierre no puede ser anterior/i)
  })

  it('acepta que falten fechas: son opcionales', () => {
    expect(validatePeriod(draft({ startsOn: '', endsOn: '', closesOn: '' }), false)).toBeNull()
  })
})

describe('periodPayload', () => {
  it('al crear manda ciclo, nivel y código', () => {
    const body = periodPayload(draft(), false, 'sy-9')
    expect(body).toMatchObject({ schoolYearId: 'sy-9', level: 'EBI', code: 'MAYO' })
    expect(body).not.toHaveProperty('isActive')
  })

  it('al editar no manda ciclo, nivel ni código: el backend los rechaza', () => {
    const body = periodPayload(draft(), true, 'sy-9')
    expect(body).not.toHaveProperty('schoolYearId')
    expect(body).not.toHaveProperty('level')
    expect(body).not.toHaveProperty('code')
    expect(body).toHaveProperty('isActive', true)
  })

  it('las fechas vacías viajan como null, no como cadena', () => {
    const body = periodPayload(draft({ startsOn: '', endsOn: '', closesOn: '' }), true, 'sy-1')
    expect(body.startsOn).toBeNull()
    expect(body.endsOn).toBeNull()
    expect(body.closesOn).toBeNull()
  })
})
