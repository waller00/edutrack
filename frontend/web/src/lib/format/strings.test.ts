import { describe, expect, it } from 'vitest'
import { compareCodeUnits, trimEndChars } from './strings'

describe('trimEndChars', () => {
  it('saca sólo los caracteres pedidos del final', () => {
    expect(trimEndChars('http://localhost:4000//', '/')).toBe('http://localhost:4000')
    expect(trimEndChars('/a/b', '/')).toBe('/a/b')
    expect(trimEndChars('', '/')).toBe('')
  })
})

describe('compareCodeUnits', () => {
  it('ordena igual que sort() sin comparador', () => {
    const values = ['notes.read', 'Events.read', 'agenda.read', 'a', '10']
    expect([...values].sort(compareCodeUnits)).toEqual([...values].sort())
    expect(compareCodeUnits('x', 'x')).toBe(0)
  })
})
