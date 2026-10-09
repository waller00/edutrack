import { describe, expect, it } from 'vitest'
import {
  computeEditableUntil,
  computeOpensAt,
  isTeacherWritableStatus,
  isWithinEditWindow,
  resolveRollCallPermissions,
  rollCallBlockedMessage,
} from './edit-window.js'

const startAt = new Date('2026-05-05T13:00:00.000Z')
const endAt = new Date('2026-05-05T14:00:00.000Z')

describe('computeEditableUntil', () => {
  it('ancla en el fin de la clase cuando la lista no se tomó', () => {
    expect(computeEditableUntil({ occurrenceEndAt: endAt, takenAt: null, windowHours: 48 })).toEqual(
      new Date('2026-05-07T14:00:00.000Z'),
    )
  })

  it('ancla en takenAt cuando la lista se tomó tarde', () => {
    const takenAt = new Date('2026-05-08T10:00:00.000Z')
    expect(computeEditableUntil({ occurrenceEndAt: endAt, takenAt, windowHours: 48 })).toEqual(
      new Date('2026-05-10T10:00:00.000Z'),
    )
  })

  it('ignora un takenAt anterior al fin de la clase', () => {
    const takenAt = new Date('2026-05-05T13:30:00.000Z')
    expect(computeEditableUntil({ occurrenceEndAt: endAt, takenAt, windowHours: 24 })).toEqual(
      new Date('2026-05-06T14:00:00.000Z'),
    )
  })
})

describe('isWithinEditWindow', () => {
  const until = new Date('2026-05-07T14:00:00.000Z')

  it('el borde exacto todavía permite editar', () => {
    expect(isWithinEditWindow(until, null, new Date('2026-05-07T14:00:00.000Z'))).toBe(true)
  })

  it('un milisegundo después ya no', () => {
    expect(isWithinEditWindow(until, null, new Date('2026-05-07T14:00:00.001Z'))).toBe(false)
  })

  it('un cierre explícito bloquea aunque la ventana siga abierta', () => {
    expect(isWithinEditWindow(until, new Date('2026-05-06T00:00:00.000Z'), new Date('2026-05-06T10:00:00.000Z'))).toBe(false)
  })

  it('un cierre programado a futuro todavía no bloquea', () => {
    expect(isWithinEditWindow(until, new Date('2026-05-07T00:00:00.000Z'), new Date('2026-05-06T10:00:00.000Z'))).toBe(true)
  })
})

describe('computeOpensAt', () => {
  it('abre 10 minutos antes del inicio', () => {
    expect(computeOpensAt(startAt)).toEqual(new Date('2026-05-05T12:50:00.000Z'))
  })
})

describe('resolveRollCallPermissions', () => {
  const base = {
    occurrenceStartAt: startAt,
    occurrenceEndAt: endAt,
    takenAt: null,
    lockedAt: null,
    windowHours: 48,
    now: new Date('2026-05-06T10:00:00.000Z'),
  }

  it('devuelve desde cuándo abre la lista', () => {
    const result = resolveRollCallPermissions({ ...base, scope: 'own', isAssignedTeacher: true })
    expect(result.opensAt).toEqual(new Date('2026-05-05T12:50:00.000Z'))
  })

  it('antes de abrir, el docente no puede pasarla', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'own',
      isAssignedTeacher: true,
      now: new Date('2026-05-05T12:49:59.999Z'),
    })
    expect(result).toMatchObject({ canEdit: false, blockedReason: 'NOT_STARTED' })
  })

  it('justo a los 10 minutos antes ya se puede', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'own',
      isAssignedTeacher: true,
      now: new Date('2026-05-05T12:50:00.000Z'),
    })
    expect(result).toMatchObject({ canEdit: true, blockedReason: null })
  })

  it('la clase de mañana tampoco la puede pasar administración', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'all',
      isAssignedTeacher: false,
      now: new Date('2026-05-04T13:00:00.000Z'),
    })
    expect(result).toMatchObject({ canEdit: false, blockedReason: 'NOT_STARTED' })
  })

  it('a quien no es docente de la clase se le dice eso, aunque no haya abierto', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'own',
      isAssignedTeacher: false,
      now: new Date('2026-05-04T13:00:00.000Z'),
    })
    expect(result.blockedReason).toBe('NOT_ASSIGNED')
  })

  it('una planilla cerrada pesa más que una clase sin abrir', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'own',
      isAssignedTeacher: true,
      lockedAt: new Date('2026-05-04T00:00:00.000Z'),
      now: new Date('2026-05-04T13:00:00.000Z'),
    })
    expect(result.blockedReason).toBe('LOCKED')
  })

  it('el docente asignado edita dentro de la ventana', () => {
    const result = resolveRollCallPermissions({ ...base, scope: 'own', isAssignedTeacher: true })
    expect(result.canEdit).toBe(true)
    expect(result.blockedReason).toBeNull()
  })

  it('quien no es docente de la clase no edita', () => {
    const result = resolveRollCallPermissions({ ...base, scope: 'own', isAssignedTeacher: false })
    expect(result).toMatchObject({ canEdit: false, blockedReason: 'NOT_ASSIGNED' })
  })

  it('vencida la ventana el docente pierde la edición', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'own',
      isAssignedTeacher: true,
      now: new Date('2026-05-30T10:00:00.000Z'),
    })
    expect(result).toMatchObject({ canEdit: false, blockedReason: 'WINDOW_EXPIRED' })
  })

  it('una planilla cerrada bloquea al docente', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'own',
      isAssignedTeacher: true,
      lockedAt: new Date('2026-05-05T20:00:00.000Z'),
    })
    expect(result).toMatchObject({ canEdit: false, blockedReason: 'LOCKED' })
  })

  it('administración no queda bloqueada por la ventana ni por el cierre', () => {
    const result = resolveRollCallPermissions({
      ...base,
      scope: 'all',
      isAssignedTeacher: false,
      lockedAt: new Date('2026-05-05T20:00:00.000Z'),
      now: new Date('2026-09-01T10:00:00.000Z'),
    })
    expect(result).toMatchObject({ canEdit: true, blockedReason: null })
  })
})

describe('rollCallBlockedMessage', () => {
  it('dice a qué hora abre la lista, en hora de Uruguay', () => {
    expect(
      rollCallBlockedMessage({ blockedReason: 'NOT_STARTED', opensAt: new Date('2026-05-05T12:50:00.000Z') }),
    ).toBe('La lista se abre a las 09:50, 10 minutos antes de la clase.')
  })

  it('explica el cierre y el plazo vencido', () => {
    expect(rollCallBlockedMessage({ blockedReason: 'LOCKED', opensAt: startAt })).toBe(
      'La planilla fue cerrada por administración.',
    )
    expect(rollCallBlockedMessage({ blockedReason: 'WINDOW_EXPIRED', opensAt: startAt })).toMatch(/Se venció el plazo/)
  })
})

describe('isTeacherWritableStatus', () => {
  it('acepta los tres estados que marca el docente', () => {
    expect(['PRESENT', 'LATE', 'ABSENT'].every(isTeacherWritableStatus)).toBe(true)
  })

  it('rechaza ABSENT_JUSTIFIED: solo se alcanza justificando', () => {
    expect(isTeacherWritableStatus('ABSENT_JUSTIFIED')).toBe(false)
  })
})
