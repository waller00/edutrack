import { describe, expect, it } from 'vitest'
import {
  FULL_ABSENCE,
  HALF_ABSENCE,
  effectiveWeight,
  formatAbsenceUnits,
  isAbsence,
  isValidAbsenceWeight,
  totalAbsenceHundredths,
} from './absence-weight.js'

describe('isAbsence', () => {
  it('la justificada sigue siendo inasistencia: cambia el motivo, no el conteo', () => {
    expect(isAbsence('ABSENT')).toBe(true)
    expect(isAbsence('ABSENT_JUSTIFIED')).toBe(true)
  })

  it('presente y llegada tarde no son inasistencia', () => {
    expect(isAbsence('PRESENT')).toBe(false)
    expect(isAbsence('LATE')).toBe(false)
  })
})

describe('effectiveWeight', () => {
  it('sin valor explícito, una ausencia pesa una falta entera', () => {
    expect(effectiveWeight({ status: 'ABSENT', absenceWeightHundredths: null })).toBe(FULL_ABSENCE)
    expect(effectiveWeight({ status: 'ABSENT_JUSTIFIED', absenceWeightHundredths: null })).toBe(FULL_ABSENCE)
  })

  it('adscripción puede bajarla a media falta', () => {
    expect(effectiveWeight({ status: 'ABSENT', absenceWeightHundredths: HALF_ABSENCE })).toBe(50)
  })

  it('lo que no es ausencia pesa cero, aunque traiga un peso cargado', () => {
    // Un peso viejo sobre una marca que después pasó a PRESENT no debe sumar.
    expect(effectiveWeight({ status: 'PRESENT', absenceWeightHundredths: 100 })).toBe(0)
    expect(effectiveWeight({ status: 'LATE', absenceWeightHundredths: 50 })).toBe(0)
  })
})

describe('totalAbsenceHundredths', () => {
  it('suma en centésimos para no arrastrar error de punto flotante', () => {
    // Tres medias faltas son 1,5 — con floats, 0.5*3 no siempre da exactamente 1.5.
    const entries = Array.from({ length: 3 }, () => ({ status: 'ABSENT', absenceWeightHundredths: HALF_ABSENCE }))
    expect(totalAbsenceHundredths(entries)).toBe(150)
  })

  it('mezcla enteras, medias y presentes', () => {
    expect(
      totalAbsenceHundredths([
        { status: 'ABSENT', absenceWeightHundredths: null },
        { status: 'ABSENT', absenceWeightHundredths: HALF_ABSENCE },
        { status: 'ABSENT_JUSTIFIED', absenceWeightHundredths: null },
        { status: 'PRESENT', absenceWeightHundredths: null },
        { status: 'LATE', absenceWeightHundredths: null },
      ]),
    ).toBe(250)
  })

  it('sin marcas da cero', () => {
    expect(totalAbsenceHundredths([])).toBe(0)
  })
})

describe('formatAbsenceUnits', () => {
  it('escribe con coma y sin decimales de más', () => {
    expect(formatAbsenceUnits(100)).toBe('1')
    expect(formatAbsenceUnits(50)).toBe('0,5')
    expect(formatAbsenceUnits(250)).toBe('2,5')
    expect(formatAbsenceUnits(0)).toBe('0')
  })
})

describe('isValidAbsenceWeight', () => {
  it('sólo admite falta y media falta', () => {
    expect(isValidAbsenceWeight(FULL_ABSENCE)).toBe(true)
    expect(isValidAbsenceWeight(HALF_ABSENCE)).toBe(true)
  })

  it('rechaza cualquier otro valor: el liceo no usa otros', () => {
    for (const value of [0, 25, 75, 101, -50]) {
      expect(isValidAbsenceWeight(value), `${value} no debería valer`).toBe(false)
    }
  })
})
