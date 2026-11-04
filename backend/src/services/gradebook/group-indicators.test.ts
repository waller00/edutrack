import { describe, expect, it } from 'vitest'
import { groupIndicators, type GroupIndicatorsInput } from './group-indicators.js'

const LEVELS = [
  { id: 'ins', label: 'Insuficiente', minValueHundredths: 100, maxValueHundredths: 499, colorToken: null, iconToken: null, isPassing: false, isAlert: true },
  { id: 'ace', label: 'Aceptable', minValueHundredths: 500, maxValueHundredths: 1000, colorToken: null, iconToken: null, isPassing: true, isAlert: false },
]
const boletin = (id: string, sortOrder: number) => ({ id, name: id, kind: 'ENTREGA', sortOrder, isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true })
const roster = [
  { studentId: 'ana', lastName: 'Pérez', firstName: 'Ana' },
  { studentId: 'beto', lastName: 'Gómez', firstName: 'Beto' },
  { studentId: 'caro', lastName: 'Díaz', firstName: 'Caro' },
]
const marks = (absent: number, justified: number, late: number, classes: number) => ({ total: { absent, justified, late, classes }, periods: {} })

function input(over: Partial<GroupIndicatorsInput> = {}): GroupIndicatorsInput {
  return {
    roster,
    attendance: [
      { studentId: 'ana', ...marks(0, 0, 0, 20) },
      { studentId: 'beto', ...marks(3, 1, 2, 20) },
      { studentId: 'caro', ...marks(1, 0, 0, 18) },
      // Alguien que ya no está en el grupo no cuenta.
      { studentId: 'baja', ...marks(9, 0, 0, 9) },
    ],
    takenClasses: 20,
    periods: [boletin('1.ª Entrega', 30), boletin('2.ª Entrega', 60), { ...boletin('Marzo-Abril', 20), kind: 'TRAMO', isMeeting: false }],
    grades: [
      { periodId: '1.ª Entrega', studentId: 'ana', meetingValueHundredths: 800 },
      { periodId: '1.ª Entrega', studentId: 'beto', meetingValueHundredths: 600 },
      { periodId: '1.ª Entrega', studentId: 'caro', meetingValueHundredths: 400 },
      { periodId: '2.ª Entrega', studentId: 'ana', meetingValueHundredths: 900 },
      { periodId: '2.ª Entrega', studentId: 'beto', meetingValueHundredths: 300 },
      { periodId: '2.ª Entrega', studentId: 'caro', meetingValueHundredths: 400 },
      { periodId: '2.ª Entrega', studentId: 'baja', meetingValueHundredths: 100 },
    ],
    closedPeriodIds: new Set(['1.ª Entrega']),
    levels: LEVELS,
    ...over,
  }
}

describe('groupIndicators', () => {
  it('las faltas a sus clases, con la base de clases y marcas, sólo del grupo', () => {
    const { attendance } = groupIndicators(input())
    expect(attendance).toMatchObject({ classesWithRollCall: 20, marks: 58, absent: 4, justified: 1, late: 2 })
    expect(attendance.students.map((s) => s.studentId)).toEqual(['beto', 'caro'])
  })

  it('la R en alerta del último boletín con notas, sin cerrar todavía', () => {
    const { grades } = groupIndicators(input())
    expect(grades.reference).toEqual({ periodId: '2.ª Entrega', name: '2.ª Entrega', closed: false })
    expect(grades).toMatchObject({ graded: 3, alert: 2 })
    expect(grades.students.map((s) => [s.studentId, s.levelLabel])).toEqual([
      ['beto', 'Insuficiente'],
      ['caro', 'Insuficiente'],
    ])
    expect(grades.distribution).toEqual([
      { levelId: 'ins', label: 'Insuficiente', isAlert: true, count: 2 },
      { levelId: 'ace', label: 'Aceptable', isAlert: false, count: 1 },
    ])
  })

  it('quiénes subieron, bajaron o siguen igual respecto del boletín anterior', () => {
    const { evolution } = groupIndicators(input())
    expect(evolution).toMatchObject({ from: { name: '1.ª Entrega' }, to: { name: '2.ª Entrega' }, compared: 3, improved: 1, same: 1, declined: 1 })
    expect(evolution?.students).toEqual([{ studentId: 'beto', lastName: 'Gómez', firstName: 'Beto', fromHundredths: 600, toHundredths: 300 }])
  })

  it('sin notas de boletín no hay referencia ni evolución; con uno solo, no hay con qué comparar', () => {
    expect(groupIndicators(input({ grades: [] }))).toMatchObject({ grades: { reference: null, graded: 0 }, evolution: null })
    const one = groupIndicators(input({ grades: input().grades.filter((g) => g.periodId === '1.ª Entrega') }))
    expect(one.grades.reference).toMatchObject({ name: '1.ª Entrega', closed: true })
    expect(one.evolution).toBeNull()
  })
})
