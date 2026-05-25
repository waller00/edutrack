import { describe, expect, it } from 'vitest'
import {
  CATALOG_COURSES,
  CATALOG_ORIENTATIONS,
  COURSE_PLANS,
  SCHOOL_YEAR_OFFERS,
  collectAllSubjectNames,
} from './academic-catalog-dges.js'

describe('academic-catalog-dges', () => {
  it('incluye los 6 cursos del catálogo', () => {
    const codes = CATALOG_COURSES.map((c) => c.code)
    expect(codes).toEqual(['7-EBI', '8-EBI', '9-EBI', '1-EMS', '2-EMS', '3-EMS'])
  })

  it('oferta 2026 excluye 2 EMS pero lo mantiene en catálogo', () => {
    expect(SCHOOL_YEAR_OFFERS[2026]?.courses['2-EMS']).toBe(false)
    expect(COURSE_PLANS['2-EMS']?.orientaciones).toBeDefined()
    expect(Object.keys(COURSE_PLANS['2-EMS']!.orientaciones!)).toHaveLength(4)
  })

  it('3 EMS tronco común no está duplicado en orientaciones', () => {
    const tronco = new Set(COURSE_PLANS['3-EMS']?.troncoComun ?? [])
    for (const subjects of Object.values(COURSE_PLANS['3-EMS']?.orientaciones ?? {})) {
      for (const s of subjects) {
        expect(tronco.has(s)).toBe(false)
      }
    }
  })

  it('genera códigos únicos por nombre de asignatura', () => {
    const map = collectAllSubjectNames()
    const codes = [...map.values()]
    expect(new Set(codes).size).toBe(codes.length)
    expect(map.size).toBeGreaterThanOrEqual(55)
  })

  it('orientaciones 3 EMS inactivas en 2026 según horario liceo', () => {
    const o = SCHOOL_YEAR_OFFERS[2026]?.orientations?.['3-EMS']
    expect(o?.['CREATIVO-ARTISTICO']).toBe(false)
    expect(o?.GENERAL).toBe(false)
    expect(o?.['CIENCIAS-VIDA']).toBe(true)
  })

  it('catálogo de orientaciones incluye las 8 subdivisiones EMS', () => {
    expect(CATALOG_ORIENTATIONS.length).toBe(8)
  })
})
