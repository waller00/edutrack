import { describe, expect, it } from 'vitest'
import { levelAccessibleText, levelStyle } from './level-tokens'

describe('levelStyle', () => {
  it('resuelve el color conocido', () => {
    expect(levelStyle({ colorToken: 'red', iconToken: null }).dotClass).toBe('bg-red-500')
  })

  it('cae a neutro con un color desconocido, sin romper', () => {
    const style = levelStyle({ colorToken: 'fucsia', iconToken: null })
    expect(style.badgeClass).toContain('gray')
  })

  it('SIEMPRE devuelve un símbolo: el nivel no puede depender sólo del color (RNF 7.2)', () => {
    const colors = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'blue', 'indigo', 'desconocido', null]
    for (const colorToken of colors) {
      expect(levelStyle({ colorToken, iconToken: null }).symbol.length).toBeGreaterThan(0)
    }
  })

  it('el iconToken del backend manda sobre el símbolo por defecto del color', () => {
    expect(levelStyle({ colorToken: 'red', iconToken: 'star' }).symbol).toBe('★')
  })

  it('los seis tramos de la escala 1 a 10 se distinguen también por símbolo', () => {
    const tokens = [
      ['red', 'alert-triangle'],
      ['orange', 'alert-circle'],
      ['yellow', 'half'],
      ['lime', 'check'],
      ['blue', 'diamond'],
      ['indigo', 'star'],
    ] as const
    const symbols = tokens.map(([colorToken, iconToken]) => levelStyle({ colorToken, iconToken }).symbol)
    expect(new Set(symbols).size).toBe(6)
  })

  it('ignora un iconToken desconocido y usa el del color', () => {
    expect(levelStyle({ colorToken: 'green', iconToken: 'unicornio' }).symbol).toBe('✓')
  })
})

describe('levelAccessibleText', () => {
  it('junta etiqueta, alerta y descriptor', () => {
    expect(
      levelAccessibleText({ label: 'Insuficiente', descriptor: 'No alcanza los aprendizajes.', isAlert: true }),
    ).toBe('Insuficiente — situación de alerta — No alcanza los aprendizajes.')
  })

  it('con lo mínimo devuelve sólo la etiqueta', () => {
    expect(levelAccessibleText({ label: 'Logrado', descriptor: null, isAlert: false })).toBe('Logrado')
  })
})
