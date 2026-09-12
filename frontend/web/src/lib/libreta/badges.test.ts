import { describe, expect, it } from 'vitest'
import { BADGE_CATALOG, absenceTone, badgeFor } from './badges'

describe('distintivos del alumno', () => {
  it('cada distintivo explica la sigla en texto', () => {
    // RNF 7.2: el color nunca puede ser la única señal, la etiqueta tiene que decir qué significa.
    for (const badge of Object.values(BADGE_CATALOG)) {
      expect(badge.label.length).toBeGreaterThan(badge.code.length)
      expect(badge.className).toMatch(/text-/)
    }
  })

  it('badgeFor resuelve sin distinguir mayúsculas', () => {
    expect(badgeFor('adec').label).toBe(BADGE_CATALOG.ADEC.label)
    expect(badgeFor('ADEC').label).toBe(BADGE_CATALOG.ADEC.label)
  })

  it('badgeFor devuelve un distintivo neutro para códigos desconocidos', () => {
    const badge = badgeFor('XYZ')
    expect(badge.code).toBe('XYZ')
    expect(badge.label).toBe('XYZ')
    expect(badge.className).toContain('gray')
  })

  it('absenceTone escala con la cantidad de faltas, en centésimos', () => {
    // 1000 centésimos = 10 faltas. Se cuenta así para que la media falta sume exacto.
    expect(absenceTone(0)).toContain('gray')
    expect(absenceTone(950)).toContain('gray')
    expect(absenceTone(1000)).toContain('amber')
    expect(absenceTone(1950)).toContain('amber')
    expect(absenceTone(2000)).toContain('red')
    expect(absenceTone(4500)).toContain('red')
  })
})
