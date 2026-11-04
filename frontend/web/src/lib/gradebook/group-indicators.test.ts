import { describe, expect, it } from 'vitest'
import { alertSummary, attendanceTiles, distributionParts, evolutionParts, groupLine, type GroupIndicators } from './group-indicators'

const indicators: GroupIndicators = {
  rosterSize: 30,
  attendance: { classesWithRollCall: 20, marks: 600, absent: 24, justified: 6, late: 12, students: [] },
  grades: {
    reference: { periodId: 'e2', name: '2.ª Entrega', closed: false },
    graded: 30,
    alert: 4,
    distribution: [
      { levelId: 'ins', label: 'Insuficiente', isAlert: true, count: 4 },
      { levelId: 'ace', label: 'Aceptable', isAlert: false, count: 20 },
      { levelId: 'muy', label: 'Muy bueno', isAlert: false, count: 6 },
    ],
    students: [],
  },
  evolution: {
    from: { periodId: 'e1', name: '1.ª Entrega' },
    to: { periodId: 'e2', name: '2.ª Entrega' },
    compared: 28,
    improved: 10,
    same: 15,
    declined: 3,
    students: [],
  },
}

describe('el seguimiento del grupo', () => {
  it('la asistencia a sus clases con su base', () => {
    const tiles = attendanceTiles(indicators.attendance)
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ['Asistencia a tus clases', '95 %'],
      ['Faltas sin justificar', '24'],
      ['Justificadas', '6'],
      ['Llegadas tarde', '12'],
    ])
    expect(tiles[0].detail).toBe('570 de 600 marcas, en 20 clases con lista.')
    expect(tiles[2].detail).toBe('De 30 faltas a tus clases.')
    expect(attendanceTiles({ ...indicators.attendance, marks: 0, absent: 0, justified: 0 })[0].value).toBe('—')
  })

  it('las notas por tramo, marcando los de alerta, y la evolución', () => {
    expect(distributionParts(indicators.grades).map((p) => [p.label, p.value, p.alert])).toEqual([
      ['Insuficiente', 4, true],
      ['Aceptable', 20, false],
      ['Muy bueno', 6, false],
    ])
    expect(evolutionParts(indicators.evolution!).map((p) => p.value)).toEqual([10, 15, 3])
  })

  it('dice si el boletín todavía no cerró', () => {
    expect(alertSummary(indicators.grades)).toBe('4 de 30 con la R en alerta en 2.ª Entrega (todavía sin cerrar).')
    const closed = { ...indicators.grades, reference: { ...indicators.grades.reference!, closed: true } }
    expect(alertSummary(closed)).toBe('4 de 30 con la R en alerta en 2.ª Entrega.')
    expect(alertSummary({ ...indicators.grades, reference: null })).toBeNull()
  })

  it('una línea por grupo para «Mi día»', () => {
    expect(groupLine(indicators)).toEqual(['asistencia 95 %', '4 de 30 con R en alerta', '3 bajaron'])
    expect(groupLine({ ...indicators, evolution: { ...indicators.evolution!, declined: 1 } })[2]).toBe('1 bajó')
    const empty = { attendance: { ...indicators.attendance, marks: 0 }, grades: { ...indicators.grades, reference: null }, evolution: null }
    expect(groupLine(empty)).toEqual([])
  })
})
