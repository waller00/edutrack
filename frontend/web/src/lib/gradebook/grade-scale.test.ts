import { describe, expect, it } from 'vitest'
import {
  formatGrade,
  gradeChoices,
  gradeSelectFromHundredths,
  gradeSelectOptions,
  gradeSelectToHundredths,
} from './grade-scale'

const EBI = { minValueHundredths: 100, maxValueHundredths: 1000 }
const EMS = { minValueHundredths: 100, maxValueHundredths: 1200 }

describe('gradeChoices', () => {
  it('ofrece el rango de la escala del nivel', () => {
    expect(gradeChoices(EBI)).toHaveLength(10)
    // Bachillerato: 11 y 12 tienen que estar.
    expect(gradeChoices(EMS).slice(-2)).toEqual([1100, 1200])
  })

  it('sin escala sembrada ofrece 1 a 10, como antes', () => {
    expect(gradeChoices(null)).toEqual(gradeChoices(EBI))
  })
})

describe('valor del selector', () => {
  it('va y vuelve en centésimos', () => {
    expect(gradeSelectFromHundredths(1100)).toBe('11')
    expect(gradeSelectToHundredths('11')).toBe(1100)
    expect(gradeSelectFromHundredths(750)).toBe('7.5')
    expect(gradeSelectToHundredths('7.5')).toBe(750)
  })

  it('vacío es sin nota', () => {
    expect(gradeSelectFromHundredths(null)).toBe('')
    expect(gradeSelectToHundredths('')).toBeNull()
    expect(gradeSelectToHundredths('abc')).toBeNull()
  })
})

describe('gradeSelectOptions', () => {
  it('suma la nota actual si la escala no la ofrece, para no borrarla al tocar el selector', () => {
    // Una R de 11 en una escala 1–10 (cargada antes de corregir la escala).
    expect(gradeSelectOptions(EBI, 1100)).toContain(1100)
    expect(gradeSelectOptions(EBI, 750)).toContain(750)
    expect(gradeSelectOptions(EBI, 800)).toEqual(gradeChoices(EBI))
  })
})

describe('formatGrade', () => {
  it('usa los decimales justos y coma decimal', () => {
    expect(formatGrade(1100)).toBe('11')
    expect(formatGrade(750)).toBe('7,5')
    expect(formatGrade(725)).toBe('7,25')
    expect(formatGrade(null)).toBe('—')
  })
})
