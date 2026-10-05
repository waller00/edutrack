import { describe, expect, it } from 'vitest'
import {
  createSourceOptions,
  createYearMessage,
  createYearPayload,
  defaultCreateDraft,
  validateCreateDraft,
  type CreateYearDraft,
} from './school-year-create'

const YEARS = [
  { id: 'y2025', code: 2025 },
  { id: 'y2026', code: 2026 },
]

function draft(over: Partial<CreateYearDraft> = {}): CreateYearDraft {
  return {
    code: '2027',
    label: 'Ciclo lectivo 2027',
    startsOn: '',
    sourceSchoolYearId: 'y2026',
    inheritPeriods: true,
    ...over,
  }
}

describe('defaultCreateDraft', () => {
  it('sugiere el año siguiente al último cargado y ese último como origen', () => {
    expect(defaultCreateDraft(YEARS, 2030)).toEqual({
      code: '2027',
      label: 'Ciclo lectivo 2027',
      startsOn: '',
      sourceSchoolYearId: 'y2026',
      inheritPeriods: true,
    })
  })

  it('sin ciclos cargados usa el año de respaldo y deja la plantilla como origen', () => {
    const result = defaultCreateDraft([], 2027)
    expect(result.code).toBe('2027')
    expect(result.sourceSchoolYearId).toBe('')
  })
})

describe('createSourceOptions', () => {
  it('ofrece todos los ciclos, del más nuevo al más viejo', () => {
    expect(createSourceOptions(YEARS)).toEqual([
      { value: 'y2026', label: '2026' },
      { value: 'y2025', label: '2025' },
    ])
  })
})

describe('validateCreateDraft', () => {
  it('acepta un borrador completo', () => {
    expect(validateCreateDraft(draft())).toBeNull()
  })

  it('exige código numérico y etiqueta', () => {
    expect(validateCreateDraft(draft({ code: 'dos mil' }))).toMatch(/código/)
    expect(validateCreateDraft(draft({ label: '   ' }))).toMatch(/etiqueta/)
  })

  it('rechaza un año fuera del rango que acepta la API', () => {
    expect(validateCreateDraft(draft({ code: '1800' }))).toMatch(/1980/)
    expect(validateCreateDraft(draft({ code: '2200' }))).toMatch(/2100/)
  })
})

describe('createYearPayload', () => {
  it('manda el ciclo origen y la bandera de herencia', () => {
    expect(createYearPayload(draft())).toEqual({
      code: 2027,
      label: 'Ciclo lectivo 2027',
      status: 'PLANNED',
      inheritAcademicPeriods: true,
      sourceSchoolYearId: 'y2026',
    })
  })

  it('no manda el origen si no se va a heredar: nadie debe creer que se copió algo', () => {
    const payload = createYearPayload(draft({ inheritPeriods: false }))
    expect(payload.inheritAcademicPeriods).toBe(false)
    expect(payload).not.toHaveProperty('sourceSchoolYearId')
  })

  it('heredar sin origen elegido es la plantilla reglamentaria', () => {
    const payload = createYearPayload(draft({ sourceSchoolYearId: '' }))
    expect(payload.inheritAcademicPeriods).toBe(true)
    expect(payload).not.toHaveProperty('sourceSchoolYearId')
  })

  it('convierte la fecha de inicio a ISO y recorta la etiqueta', () => {
    const payload = createYearPayload(draft({ startsOn: '2027-03-01', label: '  Ciclo 2027  ' }))
    expect(payload.startsOn).toBe('2027-03-01T00:00:00.000Z')
    expect(payload.label).toBe('Ciclo 2027')
  })
})

describe('createYearMessage', () => {
  it('cuenta los períodos heredados', () => {
    const message = createYearMessage({
      code: 2027,
      label: 'Ciclo lectivo 2027',
      academicPeriods: {
        schoolYearCode: 2027,
        sourceSchoolYearCode: 2026,
        created: 16,
        existing: 0,
        byLevel: {
          EBI: { origin: 'SOURCE_YEAR', created: 12, existing: 0 },
          EMS: { origin: 'SOURCE_YEAR', created: 4, existing: 0 },
        },
      },
    })
    expect(message).toBe(
      'Ciclo 2027 creado en estado planificado. Se cargaron 16 períodos del ciclo 2026 en el ciclo 2027.',
    )
  })

  it('avisa que quedó sin parametrizar cuando no se heredó', () => {
    const message = createYearMessage({ code: 2027, label: 'Ciclo lectivo 2027', academicPeriods: null })
    expect(message).toContain('Sin parametrización de libreta')
  })
})
