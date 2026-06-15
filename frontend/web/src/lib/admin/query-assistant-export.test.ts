import { describe, expect, it } from 'vitest'
import { rowsToTsv } from './query-assistant-export'

const columns = [
  { key: 'name', label: 'Nombre' },
  { key: 'hours', label: 'Horas' },
]

describe('rowsToTsv', () => {
  it('arma encabezado y filas separados por tab y salto de línea', () => {
    const tsv = rowsToTsv(columns, [
      { name: 'Ana', hours: 12 },
      { name: 'Beto', hours: 8 },
    ])
    expect(tsv).toBe('Nombre\tHoras\nAna\t12\nBeto\t8')
  })

  it('representa null/undefined como celda vacía y limpia tabs/saltos internos', () => {
    const tsv = rowsToTsv(columns, [{ name: 'Línea\tcon\ttabs', hours: null }])
    expect(tsv).toBe('Nombre\tHoras\nLínea con tabs\t')
  })

  it('devuelve cadena vacía sin columnas', () => {
    expect(rowsToTsv([], [{ name: 'x' }])).toBe('')
  })
})
