import { describe, expect, it } from 'vitest'
import {
  FULL_ABSENCE,
  HALF_ABSENCE,
  effectiveWeight,
  formatAbsenceUnits,
  isAbsence,
  isValidAbsenceWeight,
  totalAbsenceHundredths,
  absenceHundredthsFor,
  basicCycleDays,
  basicCycleMarkWeight,
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

  it('presente pesa cero, aunque traiga un peso cargado', () => {
    // Un peso viejo sobre una marca que después pasó a PRESENT no debe sumar.
    expect(effectiveWeight({ status: 'PRESENT', absenceWeightHundredths: 100 })).toBe(0)
  })

  it('la llegada tarde es media falta, sin importar el peso guardado', () => {
    expect(effectiveWeight({ status: 'LATE', absenceWeightHundredths: null })).toBe(HALF_ABSENCE)
    expect(effectiveWeight({ status: 'LATE', absenceWeightHundredths: 100 })).toBe(HALF_ABSENCE)
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
    ).toBe(300)
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

describe('ciclo básico: la falta es del día', () => {
  const mark = (ymd: string, status: string, absenceWeightHundredths: number | null = null) => ({
    ymd,
    status,
    absenceWeightHundredths,
  })

  it('pesos por marca: ausente 1, justificada y tarde ½, presente 0', () => {
    expect(basicCycleMarkWeight('ABSENT')).toBe(100)
    expect(basicCycleMarkWeight('ABSENT_JUSTIFIED')).toBe(50)
    expect(basicCycleMarkWeight('LATE')).toBe(50)
    expect(basicCycleMarkWeight('PRESENT')).toBe(0)
  })

  it('faltar a una sola materia ya es la falta del día', () => {
    const day = ['PRESENT', 'PRESENT', 'ABSENT', 'PRESENT'].map((s) => mark('2026-10-01', s))
    expect(absenceHundredthsFor(day, 'EBI')).toBe(100)
  })

  it('dos tardes el mismo día siguen siendo media falta', () => {
    expect(absenceHundredthsFor([mark('2026-10-01', 'LATE'), mark('2026-10-01', 'LATE')], 'EBI')).toBe(50)
  })

  it('tarde y ausencia el mismo día son una falta, no una y media', () => {
    expect(absenceHundredthsFor([mark('2026-10-01', 'LATE'), mark('2026-10-01', 'ABSENT')], 'EBI')).toBe(100)
  })

  it('justificada y tarde el mismo día son media falta', () => {
    expect(
      absenceHundredthsFor([mark('2026-10-01', 'ABSENT_JUSTIFIED'), mark('2026-10-01', 'LATE')], 'EBI'),
    ).toBe(50)
  })

  it('una ausencia sin justificar pesa más que la justificada del mismo día', () => {
    expect(
      absenceHundredthsFor([mark('2026-10-01', 'ABSENT_JUSTIFIED'), mark('2026-10-01', 'ABSENT')], 'EBI'),
    ).toBe(100)
  })

  it('los días se suman', () => {
    const marks = [
      mark('2026-10-01', 'ABSENT'),
      mark('2026-10-02', 'LATE'),
      mark('2026-10-02', 'LATE'),
      mark('2026-10-03', 'PRESENT'),
      mark('2026-10-05', 'ABSENT_JUSTIFIED'),
    ]
    expect(absenceHundredthsFor(marks, 'EBI')).toBe(200)
    expect(basicCycleDays(marks)).toEqual([
      { ymd: '2026-10-01', hundredths: 100 },
      { ymd: '2026-10-02', hundredths: 50 },
      { ymd: '2026-10-03', hundredths: 0 },
      { ymd: '2026-10-05', hundredths: 50 },
    ])
  })

  it('ignora el peso cargado a mano: lo fija la regla', () => {
    expect(absenceHundredthsFor([mark('2026-10-01', 'ABSENT', HALF_ABSENCE)], 'EBI')).toBe(100)
  })

  it('bachillerato y cursos sin nivel siguen sumando por marca', () => {
    const marks = [mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'LATE')]
    expect(absenceHundredthsFor(marks, 'EMS')).toBe(250)
    expect(absenceHundredthsFor(marks, null)).toBe(250)
  })
})
