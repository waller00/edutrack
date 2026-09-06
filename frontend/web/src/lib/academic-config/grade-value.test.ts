import { describe, expect, it } from 'vitest'
import { formatHundredths, formatRange, parseToHundredths } from './grade-value'

describe('formatHundredths', () => {
  it('usa coma decimal', () => {
    expect(formatHundredths(750, 1)).toBe('7,5')
    expect(formatHundredths(800, 0)).toBe('8')
    expect(formatHundredths(725, 2)).toBe('7,25')
  })

  it('acota los decimales a [0, 2]', () => {
    expect(formatHundredths(800, -1)).toBe('8')
    expect(formatHundredths(800, 5)).toBe('8,00')
  })

  it('muestra un guion cuando no hay valor', () => {
    expect(formatHundredths(null)).toBe('—')
    expect(formatHundredths(undefined)).toBe('—')
    expect(formatHundredths(Number.NaN)).toBe('—')
  })
})

describe('parseToHundredths', () => {
  it('acepta coma y punto', () => {
    expect(parseToHundredths('7,5')).toBe(750)
    expect(parseToHundredths('7.5')).toBe(750)
    expect(parseToHundredths(' 8 ')).toBe(800)
  })

  it('devuelve null si no es número o está vacío', () => {
    expect(parseToHundredths('')).toBeNull()
    expect(parseToHundredths('   ')).toBeNull()
    expect(parseToHundredths('ocho')).toBeNull()
  })

  it('hace ida y vuelta con formatHundredths', () => {
    expect(formatHundredths(parseToHundredths('7,5'), 1)).toBe('7,5')
  })
})

describe('formatRange', () => {
  it('describe el tramo', () => {
    expect(formatRange(100, 599, 0)).toBe('1 a 6')
    expect(formatRange(100, 599, 1)).toBe('1,0 a 6,0')
  })

  it('colapsa el tramo de un solo valor (escala ordinal)', () => {
    expect(formatRange(200, 200)).toBe('2')
  })
})
