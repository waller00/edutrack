import { describe, expect, it } from 'vitest'
import {
  assertCanTransition,
  assertPeriodClosed,
  blockingSections,
  canFinalize,
  currentStates,
  EndorsementError,
  pendingAgeDays,
  statusOf,
  type EndorsementRow,
  type Section,
  type Status,
} from './endorsement.js'

function row(section: Section, status: Status, iso: string): EndorsementRow {
  return { section, status, occurredAt: new Date(iso) }
}

function code(fn: () => void): string {
  try {
    fn()
    return 'NO_LANZO'
  } catch (error) {
    return (error as EndorsementError).code
  }
}

const SCOPES = {
  adscripto: { canReview: true, canEndorse: false, canInspect: false },
  direccion: { canReview: true, canEndorse: true, canInspect: false },
  inspeccion: { canReview: false, canEndorse: false, canInspect: true },
  docente: { canReview: false, canEndorse: false, canInspect: false },
}

describe('currentStates', () => {
  it('el estado vigente es la última fila de cada sección', () => {
    const states = currentStates([
      row('GRADES', 'OBSERVED', '2026-06-01T12:00:00Z'),
      row('GRADES', 'CORRECTED', '2026-06-05T12:00:00Z'),
      row('CLOSURE', 'ENDORSED', '2026-06-02T12:00:00Z'),
    ])
    expect(statusOf(states, 'GRADES')).toBe('CORRECTED')
    expect(statusOf(states, 'CLOSURE')).toBe('ENDORSED')
  })

  it('una sección sin filas es PENDING sin materializarla', () => {
    expect(statusOf(currentStates([]), 'JUDGEMENTS')).toBe('PENDING')
  })

  it('el historial anterior no se pierde: sólo cambia cuál es el vigente', () => {
    // RF-083: una observación posterior sucede al visado, no lo borra.
    const rows = [
      row('GRADES', 'ENDORSED', '2026-06-01T12:00:00Z'),
      row('GRADES', 'OBSERVED', '2026-06-10T12:00:00Z'),
    ]
    expect(statusOf(currentStates(rows), 'GRADES')).toBe('OBSERVED')
    expect(rows.filter((r) => r.status === 'ENDORSED')).toHaveLength(1)
  })
})

describe('assertCanTransition — protección del visado de Dirección', () => {
  it('INSPECCIÓN no puede tocar una sección ya visada', () => {
    // Es la nota funcional del pliego: los visados de Dirección no le son modificables.
    expect(
      code(() => assertCanTransition({ currentStatus: 'ENDORSED', nextStatus: 'OBSERVED', scopes: SCOPES.inspeccion })),
    ).toBe('ENDORSED_BY_DIRECTION')
  })

  it('ADSCRIPCIÓN tampoco: no tiene la atribución de visar ni de revertirlo', () => {
    expect(
      code(() => assertCanTransition({ currentStatus: 'ENDORSED', nextStatus: 'OBSERVED', scopes: SCOPES.adscripto })),
    ).toBe('ENDORSED_BY_DIRECTION')
  })

  it('DIRECCIÓN sí puede reabrir su propio visado', () => {
    expect(() =>
      assertCanTransition({ currentStatus: 'ENDORSED', nextStatus: 'OBSERVED', scopes: SCOPES.direccion }),
    ).not.toThrow()
  })
})

describe('assertCanTransition — quién hace qué', () => {
  it('sólo Dirección visa', () => {
    expect(() => assertCanTransition({ currentStatus: 'PENDING', nextStatus: 'ENDORSED', scopes: SCOPES.direccion })).not.toThrow()
    expect(code(() => assertCanTransition({ currentStatus: 'PENDING', nextStatus: 'ENDORSED', scopes: SCOPES.adscripto }))).toBe('CANNOT_ENDORSE')
    expect(code(() => assertCanTransition({ currentStatus: 'PENDING', nextStatus: 'ENDORSED', scopes: SCOPES.inspeccion }))).toBe('CANNOT_ENDORSE')
  })

  it('adscripción, dirección e inspección pueden observar', () => {
    for (const scopes of [SCOPES.adscripto, SCOPES.direccion, SCOPES.inspeccion]) {
      expect(() => assertCanTransition({ currentStatus: 'PENDING', nextStatus: 'OBSERVED', scopes })).not.toThrow()
    }
  })

  it('un docente sin atribuciones no observa ni visa', () => {
    expect(code(() => assertCanTransition({ currentStatus: 'PENDING', nextStatus: 'OBSERVED', scopes: SCOPES.docente }))).toBe('CANNOT_OBSERVE')
  })

  it('inspección no puede dar por corregida una observación', () => {
    expect(code(() => assertCanTransition({ currentStatus: 'OBSERVED', nextStatus: 'CORRECTED', scopes: SCOPES.inspeccion }))).toBe('CANNOT_CORRECT')
  })

  it('no se vuelve a PENDING a mano', () => {
    expect(code(() => assertCanTransition({ currentStatus: 'OBSERVED', nextStatus: 'PENDING', scopes: SCOPES.direccion }))).toBe('INVALID_TRANSITION')
  })
})

describe('visado final (RF-082)', () => {
  it('una observación viva bloquea el visado del período', () => {
    const states = currentStates([row('GRADES', 'OBSERVED', '2026-06-01T12:00:00Z')])
    expect(canFinalize(states)).toBe(false)
    expect(blockingSections(states)).toEqual(['GRADES'])
  })

  it('marcarla corregida desbloquea', () => {
    const states = currentStates([
      row('GRADES', 'OBSERVED', '2026-06-01T12:00:00Z'),
      row('GRADES', 'CORRECTED', '2026-06-05T12:00:00Z'),
    ])
    expect(canFinalize(states)).toBe(true)
  })

  it('una sección sin revisar no bloquea: puede que no hubiera nada que objetar', () => {
    expect(canFinalize(currentStates([]))).toBe(true)
  })

  it('reporta todas las secciones que bloquean, no sólo la primera', () => {
    const states = currentStates([
      row('GRADES', 'OBSERVED', '2026-06-01T12:00:00Z'),
      row('JUDGEMENTS', 'OBSERVED', '2026-06-01T12:00:00Z'),
    ])
    expect(blockingSections(states).sort()).toEqual(['GRADES', 'JUDGEMENTS'])
  })

  it('una observación sobre ALL no bloquea el visado final', () => {
    // ALL es el visado en sí, no una sección obligatoria a revisar.
    const states = currentStates([row('ALL', 'OBSERVED', '2026-06-01T12:00:00Z')])
    expect(canFinalize(states)).toBe(true)
  })
})

describe('assertPeriodClosed', () => {
  it('sólo se visa un período cerrado', () => {
    expect(() => assertPeriodClosed('CLOSED')).not.toThrow()
    expect(code(() => assertPeriodClosed('OPEN'))).toBe('PERIOD_NOT_CLOSED')
    expect(code(() => assertPeriodClosed('REOPENED'))).toBe('PERIOD_NOT_CLOSED')
  })
})

describe('pendingAgeDays', () => {
  it('cuenta días completos', () => {
    expect(pendingAgeDays(new Date('2026-06-01T12:00:00Z'), new Date('2026-06-11T12:00:00Z'))).toBe(10)
  })

  it('nunca es negativo', () => {
    expect(pendingAgeDays(new Date('2026-06-11T12:00:00Z'), new Date('2026-06-01T12:00:00Z'))).toBe(0)
  })
})
