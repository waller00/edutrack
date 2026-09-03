import { describe, expect, it } from 'vitest'
import { classifyOccurrence, eventFamilyIdOf, isOccurrenceOk } from './occurrence.js'

/** Lunes 2026-05-04, 08:00–09:00 hora Uruguay (UTC-3) => 11:00–12:00 UTC. */
function weeklyClass(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ev-1',
    type: 'CLASE',
    status: 'SCHEDULED',
    parentEventId: null,
    isRecurring: true,
    recurrenceType: 'WEEKLY',
    daysOfWeek: [1],
    startDate: new Date('2026-05-04T11:00:00.000Z'),
    startTime: new Date('2026-05-04T11:00:00.000Z'),
    endTime: new Date('2026-05-04T12:00:00.000Z'),
    recurrenceEnd: new Date('2026-12-01T00:00:00.000Z'),
    effectiveFrom: null,
    effectiveUntil: null,
    childEvents: [],
    ...overrides,
  }
}

function singleClass(overrides: Record<string, unknown> = {}) {
  return weeklyClass({
    isRecurring: false,
    recurrenceType: 'NONE',
    daysOfWeek: [],
    recurrenceEnd: null,
    ...overrides,
  })
}

describe('classifyOccurrence — rechazos', () => {
  it('no se pasa lista en eventos que no son clase', () => {
    const result = classifyOccurrence(weeklyClass({ type: 'REUNION' }), '2026-05-04')
    expect(result).toMatchObject({ ok: false, code: 'NOT_A_CLASS' })
  })

  it('nunca se ancla una sesión a una excepción puntual', () => {
    const result = classifyOccurrence(weeklyClass({ parentEventId: 'ev-parent' }), '2026-05-04')
    expect(result).toMatchObject({ ok: false, code: 'IS_EXCEPTION_CHILD' })
  })

  it('una clase cancelada no admite lista', () => {
    const result = classifyOccurrence(weeklyClass({ status: 'CANCELLED' }), '2026-05-04')
    expect(result).toMatchObject({ ok: false, code: 'EVENT_CANCELLED' })
  })

  it('un día fuera del patrón semanal no tiene ocurrencia', () => {
    // 2026-05-05 es martes; la serie solo dicta los lunes.
    const result = classifyOccurrence(weeklyClass(), '2026-05-05')
    expect(result).toMatchObject({ ok: false, code: 'NO_OCCURRENCE' })
  })

  it('una fecha fuera de la vigencia de la versión redirige a otra versión', () => {
    const event = weeklyClass({ effectiveFrom: new Date('2026-06-01T03:00:00.000Z') })
    const result = classifyOccurrence(event, '2026-05-04')
    expect(result).toMatchObject({ ok: false, code: 'OUT_OF_EFFECTIVE_WINDOW' })
  })
})

describe('classifyOccurrence — ocurrencias válidas', () => {
  it('resuelve los instantes de un lunes de la serie', () => {
    const result = classifyOccurrence(weeklyClass(), '2026-05-11')
    expect(isOccurrenceOk(result)).toBe(true)
    expect(result.startAt?.toISOString()).toBe('2026-05-11T11:00:00.000Z')
    expect(result.endAt?.toISOString()).toBe('2026-05-11T12:00:00.000Z')
  })

  it('resuelve una clase única en su propio día', () => {
    const result = classifyOccurrence(singleClass(), '2026-05-04')
    expect(isOccurrenceOk(result)).toBe(true)
    expect(result.startAt?.toISOString()).toBe('2026-05-04T11:00:00.000Z')
  })

  it('una clase única no aparece en otro día', () => {
    expect(classifyOccurrence(singleClass(), '2026-05-11')).toMatchObject({ ok: false, code: 'NO_OCCURRENCE' })
  })
})

describe('classifyOccurrence — excepciones puntuales', () => {
  it('distingue suspendida de inexistente', () => {
    const event = weeklyClass({
      childEvents: [{ startDate: new Date('2026-05-11T11:00:00.000Z'), status: 'CANCELLED' }],
    })
    // El día pertenece al patrón, pero está suspendido: el código debe decirlo,
    // no confundirse con "ese día no hay clase".
    expect(classifyOccurrence(event, '2026-05-11')).toMatchObject({ ok: false, code: 'OCCURRENCE_SUSPENDED' })
    expect(classifyOccurrence(event, '2026-05-12')).toMatchObject({ ok: false, code: 'NO_OCCURRENCE' })
  })

  it('una reprogramación puntual devuelve el horario corregido', () => {
    const event = weeklyClass({
      childEvents: [
        {
          startDate: new Date('2026-05-11T11:00:00.000Z'),
          status: 'SCHEDULED',
          startTime: new Date('2026-05-11T13:00:00.000Z'),
          endTime: new Date('2026-05-11T14:00:00.000Z'),
        },
      ],
    })
    const result = classifyOccurrence(event, '2026-05-11')
    expect(isOccurrenceOk(result)).toBe(true)
    expect(result.startAt?.toISOString()).toBe('2026-05-11T13:00:00.000Z')
    expect(result.endAt?.toISOString()).toBe('2026-05-11T14:00:00.000Z')
  })

  it('las otras fechas de la serie no se ven afectadas por una excepción', () => {
    const event = weeklyClass({
      childEvents: [{ startDate: new Date('2026-05-11T11:00:00.000Z'), status: 'CANCELLED' }],
    })
    expect(isOccurrenceOk(classifyOccurrence(event, '2026-05-18'))).toBe(true)
  })
})

describe('eventFamilyIdOf', () => {
  it('usa el id propio cuando la clase nunca se versionó', () => {
    expect(eventFamilyIdOf({ id: 'ev-1' })).toBe('ev-1')
  })

  it('usa revisionOf para agrupar las versiones de una misma clase', () => {
    expect(eventFamilyIdOf({ id: 'ev-2', revisionOf: 'ev-1' })).toBe('ev-1')
  })
})
