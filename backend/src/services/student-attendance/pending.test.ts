import { describe, expect, it } from 'vitest'
import {
  clampPendingRange,
  daysLateOf,
  PENDING_MAX_RANGE_DAYS,
  selectPendingOccurrences,
  sessionKey,
  type ExpandedOccurrence,
} from './pending.js'

const NOW = new Date('2026-05-13T12:00:00.000Z')

function occurrence(overrides: Partial<ExpandedOccurrence> = {}): ExpandedOccurrence {
  return {
    eventId: 'ev-1',
    ymd: '2026-05-11',
    startAt: new Date('2026-05-11T11:00:00.000Z'),
    endAt: new Date('2026-05-11T12:00:00.000Z'),
    title: 'Matemática',
    subject: 'Matemática',
    course: '3ºB',
    orientation: null,
    teacher: null,
    ...overrides,
  }
}

const empty = { sessions: new Map(), nonWorkingYmds: new Set<string>(), now: NOW }

describe('selectPendingOccurrences', () => {
  it('reporta una clase terminada sin lista', () => {
    const rows = selectPendingOccurrences({ occurrences: [occurrence()], ...empty })
    expect(rows).toHaveLength(1)
    expect(rows[0].daysLate).toBe(2)
  })

  it('no reporta una clase que todavía no terminó', () => {
    const future = occurrence({ endAt: new Date('2026-05-13T20:00:00.000Z') })
    expect(selectPendingOccurrences({ occurrences: [future], ...empty })).toHaveLength(0)
  })

  it('no reporta días no laborables', () => {
    const rows = selectPendingOccurrences({
      occurrences: [occurrence()],
      sessions: new Map(),
      nonWorkingYmds: new Set(['2026-05-11']),
      now: NOW,
    })
    expect(rows).toHaveLength(0)
  })

  it('no reporta una clase cuya lista ya se tomó', () => {
    const rows = selectPendingOccurrences({
      occurrences: [occurrence()],
      sessions: new Map([[sessionKey('ev-1', '2026-05-11'), { id: 's-1', status: 'TAKEN' }]]),
      nonWorkingYmds: new Set(),
      now: NOW,
    })
    expect(rows).toHaveLength(0)
  })

  it('sí reporta una planilla abierta pero nunca confirmada', () => {
    const rows = selectPendingOccurrences({
      occurrences: [occurrence()],
      sessions: new Map([[sessionKey('ev-1', '2026-05-11'), { id: 's-1', status: 'PENDING' }]]),
      nonWorkingYmds: new Set(),
      now: NOW,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].sessionId).toBe('s-1')
  })

  it('ordena cronológicamente', () => {
    const rows = selectPendingOccurrences({
      occurrences: [
        occurrence({ eventId: 'b', startAt: new Date('2026-05-11T14:00:00.000Z'), endAt: new Date('2026-05-11T15:00:00.000Z') }),
        occurrence({ eventId: 'a' }),
      ],
      ...empty,
    })
    expect(rows.map((r) => r.eventId)).toEqual(['a', 'b'])
  })
})

describe('daysLateOf', () => {
  it('una clase que acaba de terminar no está atrasada', () => {
    expect(daysLateOf(new Date('2026-05-13T11:00:00.000Z'), NOW)).toBe(0)
  })

  it('una clase futura tampoco', () => {
    expect(daysLateOf(new Date('2026-05-20T11:00:00.000Z'), NOW)).toBe(0)
  })

  it('cuenta días completos', () => {
    expect(daysLateOf(new Date('2026-05-10T12:00:00.000Z'), NOW)).toBe(3)
  })
})

describe('clampPendingRange', () => {
  it('deja pasar un rango corto', () => {
    expect(clampPendingRange('2026-05-01', '2026-05-31')).toMatchObject({ to: '2026-05-31', clamped: false })
  })

  it('recorta un rango largo para no expandir recurrencias de todo el año', () => {
    const result = clampPendingRange('2026-01-01', '2026-12-31')
    expect(result.clamped).toBe(true)
    const span = (new Date(`${result.to}T00:00:00Z`).getTime() - new Date('2026-01-01T00:00:00Z').getTime()) / 86_400_000
    expect(span).toBeLessThanOrEqual(PENDING_MAX_RANGE_DAYS)
  })
})
