import { describe, expect, it } from 'vitest'
import { LIBRETA_SECTIONS, sectionById, sectionHref, type LibretaSectionId } from './menu'

describe('menú del Libro del Profesor', () => {
  it('ordena las secciones como la libreta de papel', () => {
    expect(LIBRETA_SECTIONS.map((s) => s.id)).toEqual([
      'planificacion',
      'desarrollo',
      'evaluaciones',
      'inasistencias',
      'cierre',
      'visados',
      'mensajes',
    ])
  })

  it('cada sección explica para qué sirve', () => {
    // El hint no es decorativo: "Precierre" o "Visados" no se entienden solos.
    for (const section of LIBRETA_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0)
      expect(section.hint.length).toBeGreaterThan(20)
    }
  })

  it('no repite ids', () => {
    const ids = LIBRETA_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sectionById encuentra la sección y devuelve undefined si no existe', () => {
    expect(sectionById('cierre')?.label).toBe('Cierre de períodos')
    expect(sectionById('no-existe')).toBeUndefined()
  })

  it('sectionHref arma la ruta del módulo libreta', () => {
    expect(sectionHref('gb-1', 'evaluaciones')).toBe('/libreta/gb-1/evaluaciones')
  })

  it('toda sección del menú tiene href propio', () => {
    const hrefs = LIBRETA_SECTIONS.map((s) => sectionHref('gb-1', s.id as LibretaSectionId))
    expect(new Set(hrefs).size).toBe(LIBRETA_SECTIONS.length)
  })
})
