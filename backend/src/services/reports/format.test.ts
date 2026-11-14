import { afterEach, describe, expect, it } from 'vitest'
import { resetInstitutionTimezoneForTests, setInstitutionTimezoneForTests } from '../../config/institution-timezone.js'
import {
  absencesText,
  countOf,
  formatCount,
  formatDateTime,
  formatDecimal,
  formatHundredths,
  formatPercent,
  formatPointsChange,
  formatRatio,
  formatShare,
  formatShortYmd,
  formatYmd,
  gradeText,
  ratioValue,
  studentName,
} from './format.js'

describe('números de los informes: los mismos que la pantalla', () => {
  it('escribe cantidades y porcentajes como en Uruguay', () => {
    expect(formatCount(1034)).toBe('1.034')
    expect(formatPercent(38.64)).toBe('38,6 %')
    expect(formatPercent(40)).toBe('40 %')
  })

  it('un porcentaje siempre sale de una parte y un total', () => {
    expect(ratioValue(1, 4)).toBe(25)
    expect(formatRatio(1, 3)).toBe('33,3 %')
    expect(formatShare(34, 88)).toBe('34 de 88 (38,6 %)')
  })

  it('sin total no inventa un 0 %', () => {
    expect(ratioValue(0, 0)).toBeNull()
    expect(formatRatio(0, 0)).toBe('—')
    expect(formatShare(0, 0)).toBe('0 de 0')
  })

  it('decimales sólo cuando hacen falta', () => {
    expect(formatDecimal(7.5)).toBe('7,5')
    expect(formatDecimal(18)).toBe('18')
    expect(formatDecimal(7.456, 2)).toBe('7,46')
  })
})

describe('variación respecto del período anterior, en palabras', () => {
  it('dice si subió o bajó y cuántos puntos', () => {
    expect(formatPointsChange(1.23)).toBe('subió 1,2 puntos')
    expect(formatPointsChange(-0.5)).toBe('bajó 0,5 puntos')
    expect(formatPointsChange(1)).toBe('subió 1 punto')
    expect(formatPointsChange(0.01)).toBe('sin cambios')
  })
})

describe('fechas', () => {
  afterEach(() => resetInstitutionTimezoneForTests())

  it('día/mes/año, y la hora de la institución', () => {
    setInstitutionTimezoneForTests('America/Montevideo')
    expect(formatYmd('2026-03-01')).toBe('01/03/2026')
    expect(formatShortYmd('2026-10-05')).toBe('05/10')
    expect(formatDateTime(new Date('2026-11-13T17:05:00.000Z'))).toBe('13/11/2026 14:05')
  })
})

describe('notas y faltas en centésimos', () => {
  it('la nota como la pantalla', () => {
    expect(gradeText(800)).toBe('8')
    expect(gradeText(750)).toBe('7,5')
    expect(formatHundredths(700, 1)).toBe('7,0')
    expect(formatHundredths(null, 1)).toBe('—')
  })

  it('las faltas con su media falta', () => {
    expect(absencesText(1800)).toBe('18')
    expect(absencesText(1850)).toBe('18,5')
  })

  it('nombres y cantidades', () => {
    expect(studentName({ firstName: 'Ana', lastName: 'Pérez' })).toBe('Pérez, Ana')
    expect(countOf(1, 'estudiante', 'estudiantes')).toBe('1 estudiante')
    expect(countOf(1200, 'estudiante', 'estudiantes')).toBe('1.200 estudiantes')
  })
})
