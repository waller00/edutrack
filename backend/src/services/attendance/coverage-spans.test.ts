import { describe, it, expect } from 'vitest'
import {
  buildPresenceSpans,
  clampedOverlapMinutes,
  coverageForOccurrence,
  resolveOccurrenceOutcome,
  userDateKey,
  type AttendanceRowLite,
  type OccurrenceWindow,
} from './coverage-spans.js'

const YMD = '2025-06-02' // lunes
const USER = 'u1'

function at(hhmm: string): Date {
  return new Date(`${YMD}T${hhmm}:00.000Z`)
}

let seq = 0
function punch(type: 'CHECK_IN' | 'CHECK_OUT', hhmm: string, eventId: string | null = null): AttendanceRowLite {
  return {
    id: `p${seq++}`,
    userId: USER,
    eventId,
    date: at('00:00'),
    time: at(hhmm),
    type,
    status: type === 'CHECK_IN' ? 'PRESENT' : 'EXIT',
    notes: null,
  }
}

function occ(start: string, end: string): OccurrenceWindow {
  return { userId: USER, ymd: YMD, plannedStart: at(start), plannedEnd: at(end) }
}

describe('buildPresenceSpans', () => {
  it('empareja CHECK_IN→CHECK_OUT en spans cerrados', () => {
    const spans = buildPresenceSpans([punch('CHECK_IN', '08:00'), punch('CHECK_OUT', '09:00')])
    const list = spans.get(userDateKey(USER, YMD))!
    expect(list).toHaveLength(1)
    expect(list[0].checkOut).not.toBeNull()
  })

  it('un CHECK_IN sin salida queda como span abierto', () => {
    const spans = buildPresenceSpans([punch('CHECK_IN', '08:00')])
    const list = spans.get(userDateKey(USER, YMD))!
    expect(list).toHaveLength(1)
    expect(list[0].checkOut).toBeNull()
  })
})

describe('caso borde: presente 8-9, falta 11-12, vuelve 14-15', () => {
  const spans = buildPresenceSpans([
    punch('CHECK_IN', '08:00'),
    punch('CHECK_OUT', '09:00'),
    punch('CHECK_IN', '14:00'),
    punch('CHECK_OUT', '15:00'),
  ])
  const ctx = { hasSubstitution: false, hasLicense: false }

  it('la clase 8-9 está presente y paga 60 min', () => {
    const cov = coverageForOccurrence(occ('08:00', '09:00'), spans)
    expect(cov.covered).toBe(true)
    expect(cov.overlapMinutes).toBe(60)
    expect(resolveOccurrenceOutcome(occ('08:00', '09:00'), spans, ctx)).toBe('PRESENT')
  })

  it('la clase 11-12 queda AUSENTE y no paga', () => {
    const cov = coverageForOccurrence(occ('11:00', '12:00'), spans)
    expect(cov.covered).toBe(false)
    expect(cov.overlapMinutes).toBe(0)
    expect(resolveOccurrenceOutcome(occ('11:00', '12:00'), spans, ctx)).toBe('ABSENT_NOT_JUSTIFIED')
  })

  it('la clase 14-15 está presente y paga 60 min', () => {
    const cov = coverageForOccurrence(occ('14:00', '15:00'), spans)
    expect(cov.covered).toBe(true)
    expect(cov.overlapMinutes).toBe(60)
  })

  it('el total pago del día es 120 min (no se pagan las horas de espera ni la clase ausente)', () => {
    const total = [occ('08:00', '09:00'), occ('11:00', '12:00'), occ('14:00', '15:00')]
      .map((o) => coverageForOccurrence(o, spans).overlapMinutes)
      .reduce((a, b) => a + b, 0)
    expect(total).toBe(120)
  })
})

describe('horas puente: un solo span largo cubre varias clases con hueco', () => {
  // Entra 8:00, sale 13:00, clases 8-9 y 11-12; la espera 9-11 no se paga.
  const spans = buildPresenceSpans([punch('CHECK_IN', '08:00'), punch('CHECK_OUT', '13:00')])

  it('ambas clases quedan cubiertas', () => {
    expect(coverageForOccurrence(occ('08:00', '09:00'), spans).covered).toBe(true)
    expect(coverageForOccurrence(occ('11:00', '12:00'), spans).covered).toBe(true)
  })

  it('paga 120 min (2 clases), la espera entre clases no suma', () => {
    const total = [occ('08:00', '09:00'), occ('11:00', '12:00')]
      .map((o) => coverageForOccurrence(o, spans).overlapMinutes)
      .reduce((a, b) => a + b, 0)
    expect(total).toBe(120)
  })
})

describe('span abierto (sin CHECK_OUT)', () => {
  const spans = buildPresenceSpans([punch('CHECK_IN', '08:00')])

  it('cubre una clase posterior asumiendo permanencia y la clampea a la ventana planificada', () => {
    const cov = coverageForOccurrence(occ('11:00', '12:00'), spans)
    expect(cov.covered).toBe(true)
    expect(cov.overlapMinutes).toBe(60)
  })

  it('no cubre una clase anterior al CHECK_IN', () => {
    const lateSpans = buildPresenceSpans([punch('CHECK_IN', '14:30')])
    expect(coverageForOccurrence(occ('11:00', '12:00'), lateSpans).covered).toBe(false)
  })
})

describe('resolveOccurrenceOutcome', () => {
  it('marca LATE cuando la entrada supera la tolerancia', () => {
    const spans = buildPresenceSpans([punch('CHECK_IN', '11:20'), punch('CHECK_OUT', '12:00')])
    expect(
      resolveOccurrenceOutcome(occ('11:00', '12:00'), spans, { hasSubstitution: false, hasLicense: false, lateToleranceMinutes: 5 }),
    ).toBe('LATE')
  })

  it('marca SUBSTITUTED por encima de cualquier presencia/licencia', () => {
    const spans = buildPresenceSpans([])
    expect(resolveOccurrenceOutcome(occ('11:00', '12:00'), spans, { hasSubstitution: true, hasLicense: false })).toBe('SUBSTITUTED')
  })

  it('marca ABSENT_JUSTIFIED cuando hay licencia y no hay presencia', () => {
    const spans = buildPresenceSpans([])
    expect(resolveOccurrenceOutcome(occ('11:00', '12:00'), spans, { hasSubstitution: false, hasLicense: true })).toBe('ABSENT_JUSTIFIED')
  })
})

describe('clampedOverlapMinutes', () => {
  it('clampea la entrada temprana y la salida tardía a la ventana planificada', () => {
    expect(clampedOverlapMinutes(at('07:30'), at('09:30'), at('08:00'), at('09:00'))).toBe(60)
  })

  it('cuenta solo la fracción efectivamente presente', () => {
    expect(clampedOverlapMinutes(at('08:10'), at('08:50'), at('08:00'), at('09:00'))).toBe(40)
  })

  it('devuelve 0 si falta entrada o salida', () => {
    expect(clampedOverlapMinutes(null, at('09:00'), at('08:00'), at('09:00'))).toBe(0)
  })
})
