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
  dayRuleDays,
  dayRuleMarkWeight,
  countsByDay,
  absenceCounts,
  wholeAbsences,
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

describe('ciclo básico y bachillerato: la falta es del día', () => {
  const mark = (ymd: string, status: string, absenceWeightHundredths: number | null = null) => ({
    ymd,
    status,
    absenceWeightHundredths,
  })

  it('pesos por marca: ausente 1, justificada y tarde ½, presente 0', () => {
    expect(dayRuleMarkWeight('ABSENT')).toBe(100)
    expect(dayRuleMarkWeight('ABSENT_JUSTIFIED')).toBe(50)
    expect(dayRuleMarkWeight('LATE')).toBe(50)
    expect(dayRuleMarkWeight('PRESENT')).toBe(0)
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
    expect(dayRuleDays(marks)).toEqual([
      { ymd: '2026-10-01', hundredths: 100 },
      { ymd: '2026-10-02', hundredths: 50 },
      { ymd: '2026-10-03', hundredths: 0 },
      { ymd: '2026-10-05', hundredths: 50 },
    ])
  })

  it('ignora el peso cargado a mano: lo fija la regla', () => {
    expect(absenceHundredthsFor([mark('2026-10-01', 'ABSENT', HALF_ABSENCE)], 'EBI')).toBe(100)
  })

  it('bachillerato cuenta igual: la falta es de la jornada y la justificada vale media (REEMS)', () => {
    const marks = [mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'LATE'), mark('2026-10-02', 'ABSENT_JUSTIFIED')]
    expect(absenceHundredthsFor(marks, 'EMS')).toBe(150)
    expect(countsByDay('EMS')).toBe(true)
  })

  it('sólo un curso sin nivel sigue sumando por marca', () => {
    const marks = [mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'LATE')]
    expect(absenceHundredthsFor(marks, null)).toBe(250)
    expect(countsByDay(null)).toBe(false)
  })
})

describe('absenceCounts: J, I y tardes del boletín', () => {
  const mark = (ymd: string, status: string) => ({ ymd, status, absenceWeightHundredths: null })

  it('en ciclo básico cuenta días, cada uno en la columna de su peor marca', () => {
    const marks = [
      mark('2026-10-01', 'ABSENT'),
      mark('2026-10-01', 'ABSENT'),
      mark('2026-10-01', 'LATE'),
      mark('2026-10-02', 'ABSENT_JUSTIFIED'),
      mark('2026-10-02', 'LATE'),
      mark('2026-10-03', 'LATE'),
      mark('2026-10-03', 'LATE'),
      mark('2026-10-04', 'PRESENT'),
    ]
    expect(absenceCounts(marks, 'EBI')).toEqual({ unjustified: 1, justified: 1, lates: 1 })
    // Y cierran con el total: 1 + ½ + ½.
    expect(absenceHundredthsFor(marks, 'EBI')).toBe(200)
  })

  it('en bachillerato también cuenta días', () => {
    const marks = [mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'LATE'), mark('2026-10-02', 'ABSENT_JUSTIFIED')]
    expect(absenceCounts(marks, 'EMS')).toEqual({ unjustified: 1, justified: 1, lates: 0 })
  })

  it('un curso sin nivel cuenta marcas', () => {
    const marks = [mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'ABSENT'), mark('2026-10-01', 'LATE'), mark('2026-10-02', 'ABSENT_JUSTIFIED')]
    expect(absenceCounts(marks, null)).toEqual({ unjustified: 2, justified: 1, lates: 1 })
  })

  it('sin marcas, todo en cero', () => {
    expect(absenceCounts([], 'EBI')).toEqual({ unjustified: 0, justified: 0, lates: 0 })
  })
})

describe('wholeAbsences', () => {
  it('redondea para abajo: la media falta no suma hasta juntar otra', () => {
    expect(wholeAbsences(250)).toBe(2)
    expect(wholeAbsences(300)).toBe(3)
    expect(wholeAbsences(50)).toBe(0)
    expect(wholeAbsences(0)).toBe(0)
  })
})
