import { describe, expect, it } from 'vitest'
import {
  blockCategories,
  formatGradeList,
  gradablePeriods,
  gradesByCategory,
  judgementLabelOf,
  mergePeriodGrade,
  tramoForDate,
  type LibretaPeriod,
} from './period-blocks'

const PERIODS: LibretaPeriod[] = [
  { id: 'diag', code: 'MODULO_INTRODUCTORIO', name: 'Diagnóstico', kind: 'DIAGNOSTICO', startsOn: '2026-03-01', endsOn: '2026-03-31' },
  { id: 'marabr', code: 'MARZO_ABRIL', name: 'Marzo – Abril', kind: 'TRAMO', startsOn: '2026-03-01', endsOn: '2026-04-30' },
  { id: 'e1', code: 'ENTREGA_1', name: '1.ª Entrega', kind: 'ENTREGA', startsOn: '2026-04-15', endsOn: '2026-05-15' },
  { id: 'mayjun', code: 'MAYO_JUNIO', name: 'Mayo – Junio', kind: 'TRAMO', startsOn: '2026-05-01', endsOn: '2026-06-30' },
  { id: 'jul', code: 'JULIO', name: 'Julio', kind: 'TRAMO', startsOn: '2026-07-01', endsOn: '2026-07-31' },
]

describe('gradablePeriods', () => {
  it('sólo los tramos admiten notas sueltas', () => {
    expect(gradablePeriods(PERIODS).map((p) => p.id)).toEqual(['marabr', 'mayjun', 'jul'])
  })

  it('un período sin tipo (API vieja) se trata como tramo', () => {
    const legacy: LibretaPeriod[] = [{ id: 'x', code: 'X', name: 'X' }]
    expect(gradablePeriods(legacy)).toHaveLength(1)
  })
})

describe('tramoForDate', () => {
  it('propone el tramo que contiene el día, aunque una entrega se superponga', () => {
    expect(tramoForDate(PERIODS, '2026-04-20')?.id).toBe('marabr')
    expect(tramoForDate(PERIODS, '2026-05-10')?.id).toBe('mayjun')
  })

  it('fuera de todo tramo, el último que ya empezó; antes de empezar, el primero', () => {
    expect(tramoForDate(PERIODS, '2026-08-15')?.id).toBe('jul')
    expect(tramoForDate(PERIODS, '2026-02-10')?.id).toBe('marabr')
  })
})

describe('columnas de un tramo', () => {
  it('Or · Otras · Ev siempre; Prueba sólo si hubo alguna', () => {
    expect(blockCategories([])).toEqual(['oral', 'other', 'written'])
    expect(blockCategories([{ category: 'test' }])).toEqual(['oral', 'other', 'written', 'test'])
  })

  it('agrupa las notas sueltas por columna, sin promediar', () => {
    const buckets = gradesByCategory([
      { category: 'oral' as const, v: 7 },
      { category: 'oral' as const, v: 9 },
      { category: 'written' as const, v: 6 },
    ])
    expect(buckets.oral.map((g) => g.v)).toEqual([7, 9])
    expect(buckets.written).toHaveLength(1)
    expect(buckets.other).toEqual([])
  })
})

describe('judgementLabelOf', () => {
  it('usa el nombre configurado y, si falta, el de la planilla', () => {
    expect(judgementLabelOf({ kind: 'TRAMO', judgementLabel: 'Informe para envío APE' })).toBe('Informe para envío APE')
    expect(judgementLabelOf({ kind: 'ENTREGA', judgementLabel: null })).toBe('Informe de actuación')
    expect(judgementLabelOf({ kind: 'DIAGNOSTICO' })).toBe('Diagnóstico')
  })
})

describe('mergePeriodGrade', () => {
  const base = [{ periodId: 'p1', studentId: 's1', valueHundredths: 700, meetingValueHundredths: null, conceptualJudgement: 'Bien.' }]

  it('guardar R conserva la C y el texto', () => {
    expect(mergePeriodGrade(base, 'p1', 's1', { meetingValueHundredths: 800 })[0]).toEqual({
      ...base[0],
      meetingValueHundredths: 800,
    })
  })

  it('crea la fila si el alumno no tenía nada en el período', () => {
    const next = mergePeriodGrade(base, 'p2', 's1', { valueHundredths: 600 })
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ periodId: 'p2', valueHundredths: 600, meetingValueHundredths: null })
  })
})

describe('formatGradeList', () => {
  it('junta las notas sueltas sin promediarlas', () => {
    expect(
      formatGradeList([
        { valueHundredths: 700, isAbsent: false },
        { valueHundredths: null, isAbsent: true },
        { valueHundredths: 900, isAbsent: false },
      ]),
    ).toBe('7 · Aus · 9')
    expect(formatGradeList([])).toBe('—')
  })
})
