import { describe, expect, it } from 'vitest'
import { LIBRETA_SECTIONS, sectionById, sectionHref, sectionsFor, type LibretaSectionId } from './menu'

describe('menú del Libro del Profesor', () => {
  it('el docente trabaja su libreta y lee los mensajes del director', () => {
    expect(sectionsFor({ supervises: false }).map((s) => s.id)).toEqual([
      'planificacion',
      'desarrollo',
      'evaluaciones',
      'cierre',
      'mensajes',
    ])
    expect(sectionById('mensajes')?.label).toBe('Mensajes del director')
  })

  it('el suplente sólo tiene sus notas: lo demás de la libreta es del titular', () => {
    const sections = sectionsFor({ supervises: false, substitute: true })
    expect(sections.map((s) => s.id)).toEqual(['evaluaciones'])
    expect(sections[0].label).toBe('Tus notas (suplencia)')
  })

  it('el visado es de quien supervisa, no del docente', () => {
    expect(sectionsFor({ supervises: true }).map((s) => s.id)).toEqual([
      'planificacion',
      'desarrollo',
      'evaluaciones',
      'cierre',
      'visado',
    ])
    expect(sectionsFor({ supervises: false }).some((s) => s.id === 'visado')).toBe(false)
  })

  it('las inasistencias ya no son una sección de la libreta', () => {
    expect(sectionById('inasistencias')).toBeUndefined()
  })

  it('cada sección explica para qué sirve', () => {
    // El hint no es decorativo: "Precierre" o "Visado" no se entienden solos.
    for (const section of LIBRETA_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0)
      expect(section.hint.length).toBeGreaterThan(20)
    }
  })

  it('las calificaciones dicen qué es C y qué es R', () => {
    expect(sectionById('evaluaciones')?.hint).toMatch(/C \(conducta\) y R \(rendimiento\)/)
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
