import { describe, expect, it } from 'vitest'
import { ACTIVITY_CATEGORY_LABEL, ACTIVITY_CATEGORY_ORDER, activityCategory } from './activity-category'

describe('activityCategory', () => {
  it('usa la columna que define el tipo de actividad', () => {
    expect(activityCategory({ code: 'DEBATE', category: 'ORAL' })).toBe('oral')
    expect(activityCategory({ code: 'ESCRITO', category: 'OTRAS' })).toBe('other')
    expect(activityCategory({ code: 'X', category: 'PRUEBA' })).toBe('test')
  })

  it('sin columna, la deduce del código del catálogo', () => {
    expect(activityCategory({ code: 'ORAL' })).toBe('oral')
    expect(activityCategory({ code: 'EXPOSICION' })).toBe('oral')
    expect(activityCategory({ code: 'ESCRITO' })).toBe('written')
    expect(activityCategory({ code: 'PRUEBA' })).toBe('test')
    expect(activityCategory({ code: 'TRABAJO_EN_CLASE' })).toBe('other')
    expect(activityCategory(null)).toBe('other')
  })
})

describe('rótulos de la planilla', () => {
  it('siguen el orden Or · Otras · Ev · Prueba', () => {
    expect(ACTIVITY_CATEGORY_ORDER.map((c) => ACTIVITY_CATEGORY_LABEL[c])).toEqual(['Or', 'Otras', 'Ev', 'Prueba'])
  })
})
