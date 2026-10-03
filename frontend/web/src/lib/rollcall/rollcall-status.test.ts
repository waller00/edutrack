import { describe, expect, it } from 'vitest'
import {
  getRollCallStatusButtonClass,
  getRollCallStatusChipClass,
  getSessionStatusChipClass,
  getSessionStatusLabel,
  nextStatusOnTap,
  ROLL_CALL_STATUS_LABEL,
  ROLL_CALL_STATUS_SHORT,
  TEACHER_STATUSES,
  type RollCallStatus,
} from './rollcall-status'

const ALL: RollCallStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'ABSENT_JUSTIFIED']

describe('etiquetas', () => {
  it('cubre los cuatro estados del sistema', () => {
    expect(ALL.every((s) => Boolean(ROLL_CALL_STATUS_LABEL[s]))).toBe(true)
    expect(ALL.every((s) => Boolean(ROLL_CALL_STATUS_SHORT[s]))).toBe(true)
  })

  it('el docente solo elige tres', () => {
    expect(TEACHER_STATUSES).toEqual(['PRESENT', 'LATE', 'ABSENT'])
    expect(TEACHER_STATUSES).not.toContain('ABSENT_JUSTIFIED')
  })
})

describe('getRollCallStatusButtonClass', () => {
  it('el no seleccionado es neutro en los cuatro estados', () => {
    for (const status of ALL) {
      expect(getRollCallStatusButtonClass(status, false)).toContain('bg-white')
    }
  })

  it('cada estado seleccionado tiene su color', () => {
    expect(getRollCallStatusButtonClass('PRESENT', true)).toContain('emerald')
    expect(getRollCallStatusButtonClass('LATE', true)).toContain('amber')
    expect(getRollCallStatusButtonClass('ABSENT', true)).toContain('red')
    expect(getRollCallStatusButtonClass('ABSENT_JUSTIFIED', true)).toContain('sky')
  })
})

describe('getRollCallStatusChipClass', () => {
  it('da un color por estado y gris para sin marcar', () => {
    expect(getRollCallStatusChipClass('PRESENT')).toContain('emerald')
    expect(getRollCallStatusChipClass('LATE')).toContain('amber')
    expect(getRollCallStatusChipClass('ABSENT')).toContain('red')
    expect(getRollCallStatusChipClass('ABSENT_JUSTIFIED')).toContain('sky')
    expect(getRollCallStatusChipClass(null)).toContain('gray')
  })
})

describe('estado de la planilla', () => {
  it('distingue pasada, cerrada, sin pasar y fuera de plazo', () => {
    expect(getSessionStatusLabel('TAKEN', true)).toBe('Lista pasada')
    expect(getSessionStatusLabel('TAKEN', false)).toBe('Lista cerrada')
    expect(getSessionStatusLabel('PENDING', true)).toBe('Sin pasar')
    expect(getSessionStatusLabel('PENDING', false)).toBe('Fuera de plazo')
  })

  it('colorea sin pasar en ámbar y fuera de plazo en rojo', () => {
    expect(getSessionStatusChipClass('TAKEN', true)).toContain('emerald')
    expect(getSessionStatusChipClass('TAKEN', false)).toContain('gray')
    expect(getSessionStatusChipClass('PENDING', true)).toContain('amber')
    expect(getSessionStatusChipClass('PENDING', false)).toContain('red')
  })
})

describe('nextStatusOnTap', () => {
  it('cicla presente → tarde → ausente → presente', () => {
    expect(nextStatusOnTap('PRESENT')).toBe('LATE')
    expect(nextStatusOnTap('LATE')).toBe('ABSENT')
    expect(nextStatusOnTap('ABSENT')).toBe('PRESENT')
  })

  it('sin marcar arranca en presente', () => {
    expect(nextStatusOnTap(null)).toBe('PRESENT')
  })

  it('una falta justificada vuelve a presente al tocarla', () => {
    expect(nextStatusOnTap('ABSENT_JUSTIFIED')).toBe('PRESENT')
  })
})
