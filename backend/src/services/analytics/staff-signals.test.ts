import { describe, expect, it } from 'vitest'
import { periodSignals, type SignalsInput } from './staff-signals.js'

const KPIS = { M1_PUNCTUALITY_pct: 95, M2_LATE_RATE_pct: 5, M4_AOP_pct: 3, M6_COVERAGE_CP_pct: 97, M8_HOURS_DELTA_pct: 0, PC_count: 0 }
const COUNTS = { planned: 200, present: 194, onTime: 184, late: 10, absent: 6, plannedMinutes: 0, actualMinutes: 0 }

const input = (over: Partial<SignalsInput> = {}): SignalsInput => ({ kpis: KPIS, counts: COUNTS, people: [], events: [], ...over })

describe('lectura del período', () => {
  it('con números tranquilos, dice cuánto se miró y que se siga mirando', () => {
    expect(periodSignals(input())).toEqual([
      'Muestra amplia: 200 registros planificados. Las tendencias son más estables.',
      'Si los números se mantienen en rangos razonables, seguí mirando la evolución y compará con un período igual (por ejemplo, el mes anterior).',
    ])
  })

  it('con pocos registros avisa que una variación puede ser casualidad', () => {
    expect(periodSignals(input({ counts: { ...COUNTS, planned: 40 } }))[0]).toBe(
      'Se analizaron 40 registros planificados: con pocos registros, una variación puede ser casualidad.',
    )
  })

  it('ausentismo, tardanzas, puntualidad y licencias, con su base', () => {
    const signals = periodSignals(
      input({
        kpis: { ...KPIS, M4_AOP_pct: 15, M2_LATE_RATE_pct: 12, M1_PUNCTUALITY_pct: 80, PC_count: 2 },
        counts: { ...COUNTS, absent: 30, late: 24 },
      }),
    )
    expect(signals).toContain('Ausentismo alto: 30 de 200 (15 %) registros planificados. Conviene ver si se repite en las mismas personas o actividades.')
    expect(signals).toContain('Muchas llegadas tarde: 24 de 194 (12,4 %) entradas. Cruzalo con los horarios publicados y con el reloj de entrada.')
    expect(signals.some((s) => s.startsWith('La puntualidad está por debajo del 85 %'))).toBe(true)
    expect(signals).toContain('2 licencias inactivas coinciden con el período: revisalas antes de contar esas ausencias como sin justificar.')
  })

  it('las listas de seguimiento sólo si hay alguien o algo para revisar', () => {
    const person = { userId: 'u', displayName: 'Ana', role: 'TEACHER', plannedCount: 1, presentCount: 0, lateCount: 0, absentNotJustifiedCount: 1, absentJustifiedCount: 0, riskScore: 2 }
    const signals = periodSignals(input({ people: [person] }))
    expect(signals.some((s) => s.startsWith('La lista de personas para revisar'))).toBe(true)
    expect(periodSignals(input({ people: [{ ...person, riskScore: 0 }] })).some((s) => s.startsWith('La lista de personas'))).toBe(false)
  })

  it('sin registros no dice nada de la muestra', () => {
    expect(periodSignals(input({ counts: { ...COUNTS, planned: 0 } }))[0]).toMatch(/^Si los números/)
  })
})
