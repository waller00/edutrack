import { describe, expect, it } from 'vitest'
import { displayNameOf, foldForSearch, matchesSearch, messagePreview, pairKeyOf } from './text.js'

describe('mensajería: partes puras', () => {
  it('el par tiene una sola clave, escriba quien escriba primero', () => {
    expect(pairKeyOf('b', 'a')).toBe('a:b')
    expect(pairKeyOf('a', 'b')).toBe(pairKeyOf('b', 'a'))
  })

  it('la vista previa es una línea y se recorta con puntos suspensivos', () => {
    expect(messagePreview('Hola\n\n  ¿cómo   estás?')).toBe('Hola ¿cómo estás?')
    const long = 'x'.repeat(200)
    const preview = messagePreview(long, 20)
    expect(preview).toHaveLength(20)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('busca sin tildes ni mayúsculas', () => {
    expect(foldForSearch('  GIMÉNEZ ')).toBe('gimenez')
    expect(matchesSearch({ firstName: 'Leopoldo', lastName: 'Giménez' }, 'gimenez')).toBe(true)
    expect(matchesSearch({ firstName: 'Ana', lastName: 'García' }, 'ana gar')).toBe(true)
    expect(matchesSearch({ firstName: 'Ana', lastName: 'García' }, 'ana pérez')).toBe(false)
    expect(matchesSearch({ firstName: 'Ana' }, '   ')).toBe(true)
  })

  it('muestra nombre y apellido, o el nombre cargado, o "Usuario"', () => {
    expect(displayNameOf({ firstName: 'Ana', lastName: 'García', name: 'otra cosa' })).toBe('Ana García')
    expect(displayNameOf({ firstName: null, lastName: null, name: ' Dirección ' })).toBe('Dirección')
    expect(displayNameOf({})).toBe('Usuario')
  })
})
