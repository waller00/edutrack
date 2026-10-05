import { describe, expect, it } from 'vitest'
import {
  defaultInheritSourceId,
  describeInheritance,
  describeProvision,
  inheritSourceOptions,
  type PeriodInheritanceSummary,
} from './period-inheritance'

const YEARS = [
  { id: 'y2025', code: 2025 },
  { id: 'y2026', code: 2026 },
  { id: 'y2027', code: 2027 },
]

function summary(over: Partial<PeriodInheritanceSummary> = {}): PeriodInheritanceSummary {
  return {
    schoolYearCode: 2027,
    sourceSchoolYearCode: 2026,
    created: 16,
    existing: 0,
    byLevel: {
      EBI: { origin: 'SOURCE_YEAR', created: 12, existing: 0 },
      EMS: { origin: 'SOURCE_YEAR', created: 4, existing: 0 },
    },
    ...over,
  }
}

describe('inheritSourceOptions', () => {
  it('excluye el ciclo destino y ordena del más nuevo al más viejo', () => {
    expect(inheritSourceOptions(YEARS, 'y2026')).toEqual([
      { value: 'y2027', label: '2027' },
      { value: 'y2025', label: '2025' },
    ])
  })

  it('sin destino ofrece todos los ciclos', () => {
    expect(inheritSourceOptions(YEARS, null)).toHaveLength(3)
  })
})

describe('defaultInheritSourceId', () => {
  it('sugiere el ciclo inmediatamente anterior, no el más reciente', () => {
    expect(defaultInheritSourceId(YEARS, 'y2026')).toBe('y2025')
  })

  it('si el destino es el más viejo, cae al más reciente disponible', () => {
    expect(defaultInheritSourceId(YEARS, 'y2025')).toBe('y2027')
  })

  it('sin otros ciclos devuelve vacío: queda la plantilla', () => {
    expect(defaultInheritSourceId([{ id: 'y2026', code: 2026 }], 'y2026')).toBe('')
    expect(defaultInheritSourceId([], 'y2026')).toBe('')
  })
})

describe('describeInheritance', () => {
  it('cuenta de dónde salió cada período cuando se mezclan origen y plantilla', () => {
    const text = describeInheritance(
      summary({
        byLevel: {
          EBI: { origin: 'SOURCE_YEAR', created: 12, existing: 0 },
          EMS: { origin: 'TEMPLATE', created: 4, existing: 0 },
        },
      }),
    )
    expect(text).toBe(
      'Se cargaron 12 períodos del ciclo 2026 y 4 períodos de la plantilla reglamentaria en el ciclo 2027.',
    )
  })

  it('informa cuando todo vino del ciclo origen', () => {
    expect(describeInheritance(summary())).toBe('Se cargaron 16 períodos del ciclo 2026 en el ciclo 2027.')
  })

  it('avisa que no se cambió nada si ya estaban todos', () => {
    const text = describeInheritance(
      summary({
        created: 0,
        existing: 16,
        byLevel: {
          EBI: { origin: 'SOURCE_YEAR', created: 0, existing: 12 },
          EMS: { origin: 'SOURCE_YEAR', created: 0, existing: 4 },
        },
      }),
    )
    expect(text).toBe('El ciclo 2027 ya tenía sus 16 períodos: no se cambió nada.')
  })

  it('aclara que los que ya estaban quedaron intactos', () => {
    const text = describeInheritance(
      summary({
        created: 4,
        existing: 12,
        byLevel: {
          EBI: { origin: 'SOURCE_YEAR', created: 0, existing: 12 },
          EMS: { origin: 'TEMPLATE', created: 4, existing: 0 },
        },
      }),
    )
    expect(text).toContain('Los 12 períodos que ya estaban quedaron intactos.')
  })

  it('usa el singular cuando es uno solo', () => {
    const text = describeInheritance(
      summary({
        created: 1,
        byLevel: { EBI: { origin: 'SOURCE_YEAR', created: 1, existing: 0 } },
      }),
    )
    expect(text).toContain('1 período del ciclo 2026')
  })
})

describe('describeProvision', () => {
  it('resume libretas nuevas y actualizadas', () => {
    expect(describeProvision({ created: 3, updated: 48 })).toBe('3 libretas nuevas, 48 actualizadas.')
  })

  it('usa el singular con una sola', () => {
    expect(describeProvision({ created: 1, updated: 1 })).toBe('1 libreta nueva, 1 actualizada.')
  })

  it('explica cuando el horario todavía no da para ninguna libreta', () => {
    expect(describeProvision({ created: 0, updated: 0 })).toBe(
      'No había clases en el horario de las que derivar libretas.',
    )
  })

  it('informa lo que quedó afuera', () => {
    expect(describeProvision({ created: 1, updated: 0, skippedEvents: 2, skippedNotOffered: 1 })).toContain(
      'Sin contar 2 clase(s) sin asignatura o sin grupo y 1 grupo(s) que ya no se dictan.',
    )
  })
})
