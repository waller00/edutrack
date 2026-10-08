import { describe, expect, it } from 'vitest'
import { safeReturnPath } from './return-path'

describe('safeReturnPath', () => {
  it('acepta la reunión con su grupo y período', () => {
    expect(safeReturnPath('/libreta/reunion?grupo=off-1%3A%3Aco-1&periodo=p-1', '/libreta/reunion')).toBe(
      '/libreta/reunion?grupo=off-1%3A%3Aco-1&periodo=p-1',
    )
  })

  it('rechaza lo que saldría de la libreta', () => {
    for (const value of ['https://otro.com/libreta/', '//otro.com/libreta/', '/admin/users', '/libreta\\..\\x', '']) {
      expect(safeReturnPath(value, '/libreta/reunion')).toBe('/libreta/reunion')
    }
    expect(safeReturnPath(undefined, '/libreta/reunion')).toBe('/libreta/reunion')
  })

  it('con varios valores toma el primero', () => {
    expect(safeReturnPath(['/libreta/control', '/libreta/reunion'], '/x')).toBe('/libreta/control')
  })
})
