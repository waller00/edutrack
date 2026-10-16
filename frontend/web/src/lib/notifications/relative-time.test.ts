import { describe, expect, it } from 'vitest'
import { dayGroupLabel, relativeTime, timeWithinDay } from './relative-time'
import { notificationKind } from './kinds'

// Jueves 8/10/2026, 15:00 en Uruguay.
const now = new Date('2026-10-08T18:00:00.000Z')

describe('relativeTime', () => {
  it('lo recién llegado es "ahora", y después minutos y horas', () => {
    expect(relativeTime('2026-10-08T17:59:40.000Z', now)).toBe('ahora')
    expect(relativeTime('2026-10-08T17:55:00.000Z', now)).toBe('hace 5 min')
    expect(relativeTime('2026-10-08T15:30:00.000Z', now)).toBe('hace 2 h')
  })

  it('ayer es el día civil anterior en Uruguay, con la hora', () => {
    // 7/10 a las 23:30 en Uruguay (8/10 02:30 UTC): es ayer, aunque en UTC ya sea el mismo día.
    expect(relativeTime('2026-10-08T02:30:00.000Z', now)).toBe('ayer 23:30')
  })

  it('más atrás, la fecha; de otro año, con el año', () => {
    expect(relativeTime('2026-09-30T15:00:00.000Z', now)).toBe('30/09')
    expect(relativeTime('2025-12-30T15:00:00.000Z', now)).toBe('30/12/25')
  })

  it('un reloj adelantado no da tiempos negativos', () => {
    expect(relativeTime('2026-10-08T18:05:00.000Z', now)).toBe('ahora')
  })
})

describe('dayGroupLabel y timeWithinDay', () => {
  it('agrupa por Hoy, Ayer y el día en palabras', () => {
    expect(dayGroupLabel('2026-10-08T12:00:00.000Z', now)).toBe('Hoy')
    expect(dayGroupLabel('2026-10-07T12:00:00.000Z', now)).toBe('Ayer')
    expect(dayGroupLabel('2026-10-05T12:00:00.000Z', now)).toBe('Lunes 5 de octubre')
    expect(dayGroupLabel('2025-10-05T12:00:00.000Z', now)).toBe('Domingo 5 de octubre de 2025')
  })

  it('dentro de un día: hoy hace cuánto, otro día la hora', () => {
    expect(timeWithinDay('2026-10-08T17:55:00.000Z', now)).toBe('hace 5 min')
    expect(timeWithinDay('2026-10-05T12:30:00.000Z', now)).toBe('09:30')
  })
})

describe('notificationKind', () => {
  it('cada tipo tiene etiqueta e ícono', () => {
    expect(notificationKind('LICENSE_UPDATED').label).toBe('Licencias')
    expect(notificationKind('EVENT_ASSIGNED').label).toBe('Agenda')
    expect(notificationKind('GRADEBOOK_OBSERVATION').label).toBe('Libreta')
    expect(notificationKind('GRADEBOOK_MESSAGE').label).toBe('Libreta')
    expect(notificationKind('STUDENT_ALERT').label).toBe('Alertas')
    expect(notificationKind('ATTENDANCE_INCIDENT').label).toBe('Asistencia')
    expect(notificationKind('ROLL_CALL_LATE').label).toBe('Pase de lista')
    expect(notificationKind('ALGO_NUEVO').label).toBe('Aviso')
  })
})
