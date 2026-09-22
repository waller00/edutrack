import { describe, expect, it } from 'vitest'
import {
  EBI_PERIODS,
  GLOBAL_ACTIVITY_TYPES,
  GRADING_SCALES,
  RETIRED_EBI_PERIOD_CODES,
} from './academic-config-dges.js'

describe('academic-config-dges · períodos EBI', () => {
  it('sigue el orden de los bloques de la planilla del liceo', () => {
    expect(EBI_PERIODS.map((p) => p.code)).toEqual([
      'MODULO_INTRODUCTORIO',
      'MARZO_ABRIL',
      'ENTREGA_1',
      'MAYO_JUNIO',
      'JULIO',
      'ENTREGA_2',
      'AGOSTO_SETIEMBRE',
      'ENTREGA_3',
      'OCTUBRE_NOVIEMBRE',
      'ENTREGA_4',
      'APE_DICIEMBRE',
      'APE_FEBRERO',
    ])
    const orders = EBI_PERIODS.map((p) => p.sortOrder)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('toda entrega lleva reunión y exige C, R e informe de actuación', () => {
    const entregas = EBI_PERIODS.filter((p) => p.kind === 'ENTREGA')
    expect(entregas).toHaveLength(4)
    for (const period of entregas) {
      expect(period).toMatchObject({
        isMeeting: true,
        requiresGeneralGrade: true,
        requiresConceptualJudgement: true,
        judgementLabel: 'Informe de actuación',
      })
    }
  })

  it('los tramos de trabajo no exigen nada para cerrar', () => {
    const tramos = EBI_PERIODS.filter((p) => (p.kind ?? 'TRAMO') === 'TRAMO' && !p.isMeeting)
    expect(tramos.map((p) => p.code)).toEqual([
      'MARZO_ABRIL',
      'MAYO_JUNIO',
      'JULIO',
      'AGOSTO_SETIEMBRE',
      'OCTUBRE_NOVIEMBRE',
    ])
    for (const period of tramos) {
      expect(period.requiresGeneralGrade).toBe(false)
      expect(period.requiresConceptualJudgement).toBe(false)
    }
  })

  it('no vuelve a sembrar los códigos retirados', () => {
    const codes = new Set(EBI_PERIODS.map((p) => p.code))
    for (const retired of RETIRED_EBI_PERIOD_CODES) expect(codes.has(retired)).toBe(false)
  })
})

describe('academic-config-dges · escala 1 a 10', () => {
  const scale = GRADING_SCALES.find((s) => s.code === 'NUMERICA_1_10')!

  it('tiene los seis tramos de la planilla, contiguos de 1 a 10', () => {
    const levels = [...scale.levels].sort((a, b) => a.minValueHundredths - b.minValueHundredths)
    expect(levels.map((l) => l.colorToken)).toEqual(['red', 'orange', 'yellow', 'lime', 'blue', 'indigo'])
    expect(levels[0]!.minValueHundredths).toBe(scale.minValueHundredths)
    expect(levels.at(-1)!.maxValueHundredths).toBe(scale.maxValueHundredths)
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!.minValueHundredths).toBe(levels[i - 1]!.maxValueHundredths + 1)
    }
  })

  it('aprueba a partir de 5', () => {
    for (const level of scale.levels) {
      expect(level.isPassing).toBe(level.minValueHundredths >= 500)
    }
  })

  it('cada tramo lleva símbolo además del color (RNF 7.2)', () => {
    for (const level of scale.levels) expect(level.iconToken).toBeTruthy()
    expect(new Set(scale.levels.map((l) => l.iconToken)).size).toBe(scale.levels.length)
  })
})

describe('academic-config-dges · tipos de actividad', () => {
  it('ubica cada tipo en una columna de la planilla', () => {
    const byCode = Object.fromEntries(GLOBAL_ACTIVITY_TYPES.map((t) => [t.code, t.category]))
    expect(byCode).toMatchObject({
      ORAL: 'ORAL',
      EXPOSICION: 'ORAL',
      PARTICIPACION: 'ORAL',
      ESCRITO: 'ESCRITO',
      PRUEBA: 'PRUEBA',
      TRABAJO_DOMICILIARIO: 'OTRAS',
    })
  })
})
