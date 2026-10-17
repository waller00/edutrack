import { describe, expect, it } from 'vitest'
import {
  classGroupLabel,
  classTeacherLine,
  dayRollCallChipClass,
  dayRollCallLabel,
  dayRollCallPhase,
  dayRollCallTally,
  formatRollCallDay,
  isRollCallDue,
  rollCallPhase,
  rollCallPhaseChipClass,
  rollCallPhaseLabel,
  type RollCallTiming,
} from './rollcall-phase'

/** Clase 10:00–10:45 en Uruguay (13:00–13:45 UTC), abre 09:50, plazo 48 h. */
const timing: RollCallTiming = {
  status: 'PENDING',
  blockedReason: null,
  opensAt: '2026-10-08T12:50:00.000Z',
  endAt: '2026-10-08T13:45:00.000Z',
  editableUntil: '2026-10-10T13:45:00.000Z',
  takenAt: null,
}

const at = (iso: string) => new Date(iso)

describe('rollCallPhase', () => {
  it('antes de abrir, todavía no se pasa', () => {
    expect(rollCallPhase(timing, at('2026-10-08T12:49:00.000Z'))).toBe('UPCOMING')
  })

  it('aunque el servidor haya dicho "no empezó", a la hora de abrir ya está abierta', () => {
    expect(rollCallPhase({ ...timing, blockedReason: 'NOT_STARTED' }, at('2026-10-08T12:50:00.000Z'))).toBe('OPEN')
  })

  it('en clase y sin pasar, es el momento', () => {
    expect(rollCallPhase(timing, at('2026-10-08T13:10:00.000Z'))).toBe('OPEN')
  })

  it('terminada la clase sin lista, queda sin pasar', () => {
    expect(rollCallPhase(timing, at('2026-10-08T14:00:00.000Z'))).toBe('OVERDUE')
  })

  it('vencido el plazo sin lista, queda fuera de plazo', () => {
    expect(rollCallPhase(timing, at('2026-10-11T10:00:00.000Z'))).toBe('EXPIRED')
  })

  it('pasada: se puede corregir dentro del plazo y después queda cerrada', () => {
    const taken = { ...timing, status: 'TAKEN' as const, takenAt: '2026-10-08T13:07:00.000Z' }
    expect(rollCallPhase(taken, at('2026-10-08T14:00:00.000Z'))).toBe('TAKEN')
    expect(rollCallPhase(taken, at('2026-10-11T10:00:00.000Z'))).toBe('CLOSED')
  })

  it('el cierre de administración y "no es tu clase" no dependen de la hora', () => {
    expect(rollCallPhase({ ...timing, blockedReason: 'LOCKED' }, at('2026-10-08T13:10:00.000Z'))).toBe('LOCKED')
    expect(rollCallPhase({ ...timing, blockedReason: 'NOT_ASSIGNED' }, at('2026-10-08T13:10:00.000Z'))).toBe('NOT_ASSIGNED')
  })

  it('al titular de un día cubierto se le dice que la lista la pasa el suplente', () => {
    const phase = rollCallPhase({ ...timing, blockedReason: 'COVERED_BY_SUBSTITUTE' }, at('2026-10-08T13:10:00.000Z'))
    expect(phase).toBe('COVERED')
    expect(isRollCallDue(phase)).toBe(false)
    expect(rollCallPhaseLabel(phase, timing)).toBe('La pasa el suplente')
  })

  it('sólo "abierta" y "sin pasar" piden pasar la lista', () => {
    expect(isRollCallDue('OPEN')).toBe(true)
    expect(isRollCallDue('OVERDUE')).toBe(true)
    expect(isRollCallDue('UPCOMING')).toBe(false)
    expect(isRollCallDue('TAKEN')).toBe(false)
  })
})

describe('rollCallPhaseLabel', () => {
  it('dice a qué hora abre y a qué hora se pasó, en hora de Uruguay', () => {
    expect(rollCallPhaseLabel('UPCOMING', timing)).toBe('Abre 09:50')
    expect(rollCallPhaseLabel('TAKEN', { ...timing, takenAt: '2026-10-08T13:07:00.000Z' })).toBe('Pasada 10:07')
  })

  it('cada fase tiene texto, no sólo color', () => {
    expect(rollCallPhaseLabel('OPEN', timing)).toBe('Pasá la lista')
    expect(rollCallPhaseLabel('OVERDUE', timing)).toBe('Sin pasar')
    expect(rollCallPhaseLabel('EXPIRED', timing)).toBe('Fuera de plazo')
    expect(rollCallPhaseLabel('LOCKED', timing)).toBe('Cerrada por administración')
  })

  it('la lista abierta se destaca', () => {
    expect(rollCallPhaseChipClass('OPEN')).toContain('bg-emerald-600')
    expect(rollCallPhaseChipClass('OVERDUE')).toContain('amber')
  })
})

describe('la lista en el resumen del día de administración', () => {
  const rollCall = {
    eventId: 'ev-1',
    ymd: '2026-10-08',
    status: 'PENDING' as const,
    takenAt: null,
    takenBy: null,
    opensAt: '2026-10-08T12:50:00.000Z',
    endAt: '2026-10-08T13:45:00.000Z',
  }

  it('dice si abrió, si está abierta o si quedó sin pasar', () => {
    expect(dayRollCallLabel(rollCall, at('2026-10-08T12:00:00.000Z'))).toBe('Lista: abre 09:50')
    expect(dayRollCallLabel(rollCall, at('2026-10-08T13:00:00.000Z'))).toBe('Lista abierta, sin pasar')
    expect(dayRollCallLabel(rollCall, at('2026-10-08T15:00:00.000Z'))).toBe('Lista sin pasar')
  })

  it('pasada: a qué hora y quién', () => {
    const taken = { ...rollCall, status: 'TAKEN' as const, takenAt: '2026-10-08T13:07:00.000Z', takenBy: 'Juan Gómez' }
    expect(dayRollCallLabel(taken, at('2026-10-09T15:00:00.000Z'))).toBe('Lista pasada 10:07 · Juan Gómez')
    expect(dayRollCallChipClass(dayRollCallPhase(taken))).toContain('emerald')
  })

  it('para administración el plazo no corre', () => {
    expect(dayRollCallPhase(rollCall, at('2026-12-01T00:00:00.000Z'))).toBe('OVERDUE')
  })

  it('cuenta cada clase una vez y sólo las que ya abrieron', () => {
    const taken = { ...rollCall, status: 'TAKEN' as const }
    const later = { ...rollCall, eventId: 'ev-2', opensAt: '2026-10-08T18:00:00.000Z', endAt: '2026-10-08T19:00:00.000Z' }
    const pending = { ...rollCall, eventId: 'ev-3' }
    expect(dayRollCallTally([taken, taken, later, pending, null], at('2026-10-08T14:00:00.000Z'))).toEqual({
      taken: 1,
      opened: 2,
    })
  })
})

describe('classGroupLabel y formatRollCallDay', () => {
  it('une grupo y orientación', () => {
    expect(classGroupLabel('3.º B', 'Científico')).toBe('3.º B · Científico')
    expect(classGroupLabel('3.º B', null)).toBe('3.º B')
    expect(classGroupLabel(null, null)).toBe('Sin grupo')
  })

  it('escribe el día en palabras', () => {
    expect(formatRollCallDay('2026-10-08')).toBe('Jueves 8 de octubre')
  })
})

describe('classTeacherLine', () => {
  const ana = { id: 'ana', name: 'Ana Pérez' }
  const juan = { id: 'juan', name: 'Juan Gómez' }

  it('el titular que da su clase no necesita línea', () => {
    expect(classTeacherLine({ meId: 'ana', teacher: ana, substitute: null })).toBeNull()
  })

  it('al suplente le dice a quién cubre', () => {
    expect(classTeacherLine({ meId: 'juan', teacher: ana, substitute: juan })).toBe('Suplencia: cubrís a Ana Pérez')
  })

  it('al titular cubierto le dice quién la pasa', () => {
    expect(classTeacherLine({ meId: 'ana', teacher: ana, substitute: juan })).toBe('La pasa Juan Gómez (suplencia)')
  })

  it('a administración le dice quién da la clase', () => {
    expect(classTeacherLine({ meId: 'admin', teacher: ana, substitute: null })).toBe('Docente: Ana Pérez')
    expect(classTeacherLine({ meId: 'admin', teacher: ana, substitute: juan })).toBe(
      'Docente: Juan Gómez, suplente de Ana Pérez',
    )
  })
})
