import { describe, expect, it } from 'vitest'
import { BADGE_CATALOG, absenceLabel, badgeFor } from './badges'

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

  it('las faltas de la lista del grupo dicen que son del liceo, sin colores de alarma', () => {
    expect(absenceLabel(100, '1')).toBe('1 falta en el liceo')
    expect(absenceLabel(1850, '18,5')).toBe('18,5 faltas en el liceo')
  })
})
