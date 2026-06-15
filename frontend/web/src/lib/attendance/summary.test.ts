import { describe, it, expect } from 'vitest'
import { estadoToCategory, dominantCategory, groupRowsByDate, type AttendanceSummaryRow } from './summary'

function row(fecha: string, estado: string): AttendanceSummaryRow {
  return {
    fecha,
    estado,
    evento: 'X',
    tipoEvento: 'Clase',
    horaPlanIn: '',
    horaPlanOut: '',
    horaRealIn: '',
    horaRealOut: '',
    minTarde: 0,
    horasTrab: 0,
    licencia: 'NO',
    observaciones: '-',
  }
}

describe('estadoToCategory', () => {
  it('clasifica cada etiqueta de estado', () => {
    expect(estadoToCategory('Presente')).toBe('present')
    expect(estadoToCategory('Tarde')).toBe('late')
    expect(estadoToCategory('Ausente no justificado')).toBe('absent')
    expect(estadoToCategory('Ausente justificado')).toBe('justified')
    expect(estadoToCategory('Suplido')).toBe('substituted')
    expect(estadoToCategory('Cobertura (suplencia)')).toBe('substituted')
    expect(estadoToCategory('Lo que sea')).toBe('none')
  })
})

describe('dominantCategory', () => {
  it('elige el peor estado del día', () => {
    expect(dominantCategory([row('d', 'Presente'), row('d', 'Ausente no justificado')])).toBe('absent')
    expect(dominantCategory([row('d', 'Presente'), row('d', 'Tarde')])).toBe('late')
    expect(dominantCategory([])).toBe('none')
  })
})

describe('groupRowsByDate', () => {
  it('agrupa filas por fecha', () => {
    const grouped = groupRowsByDate([row('2026-05-20', 'Presente'), row('2026-05-20', 'Tarde'), row('2026-05-21', 'Presente')])
    expect(grouped.get('2026-05-20')).toHaveLength(2)
    expect(grouped.get('2026-05-21')).toHaveLength(1)
  })
})
