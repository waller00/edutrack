import { describe, expect, it } from 'vitest'
import { csvCell } from './csv.js'

describe('csvCell', () => {
  it('neutraliza lo que Excel ejecutaría como fórmula', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")', ',')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`)
    expect(csvCell('+5+cmd', ';')).toBe("'+5+cmd")
    expect(csvCell('@SUM(A1)', ',')).toBe("'@SUM(A1)")
    expect(csvCell('-2+3', ',')).toBe("'-2+3")
  })

  it('deja los números negativos como números', () => {
    expect(csvCell('-15', ',')).toBe('-15')
    expect(csvCell('-1,50', ';')).toBe('-1,50')
    expect(csvCell(-3, ',')).toBe('-3')
  })

  it('entrecomilla según el separador y los saltos de línea', () => {
    expect(csvCell('Pérez, Ana', ',')).toBe('"Pérez, Ana"')
    expect(csvCell('Pérez, Ana', ';')).toBe('Pérez, Ana')
    expect(csvCell('a;b', ';')).toBe('"a;b"')
    expect(csvCell('línea 1\r\nlínea 2', ',')).toBe('"línea 1\r\nlínea 2"')
    expect(csvCell(null, ',')).toBe('')
  })
})
