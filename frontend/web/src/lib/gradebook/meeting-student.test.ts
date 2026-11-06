import { describe, expect, it } from 'vitest'
import {
  assessmentResult,
  gradeChange,
  neighbors,
  schoolAbsenceSummary,
  shortDate,
  subjectAbsenceDetail,
  subjectAbsenceSummary,
  subjectCounts,
  type MeetingStudentSubject,
} from './meeting-student'
import { currentByKey, currentDecisionIds, judgementState, meetingRecordsPath } from './meeting-records'

describe('gradeChange', () => {
  it('subió, bajó o igual, con flecha, palabra y las dos notas', () => {
    expect(gradeChange(600, 400)).toEqual({ direction: 'down', symbol: '↓', word: 'bajó', text: '6 → 4' })
    expect(gradeChange(400, 750)).toMatchObject({ direction: 'up', symbol: '↑', text: '4 → 7,5' })
    expect(gradeChange(700, 700)).toMatchObject({ direction: 'same', word: 'igual' })
  })

  it('sin alguna de las dos no hay cambio que decir', () => {
    expect(gradeChange(null, 700)).toBeNull()
    expect(gradeChange(700, null)).toBeNull()
  })
})

describe('assessmentResult / shortDate', () => {
  const base = { valueHundredths: null, isAbsent: false, levelLabel: null, missing: false }
  it('la nota, «No rindió», el tramo o «Sin nota»', () => {
    expect(assessmentResult({ ...base, valueHundredths: 800 })).toBe('8')
    expect(assessmentResult({ ...base, isAbsent: true })).toBe('No rindió')
    expect(assessmentResult({ ...base, levelLabel: 'Logrado' })).toBe('Logrado')
    expect(assessmentResult({ ...base, missing: true })).toBe('Sin nota')
  })

  it('la fecha corta', () => {
    expect(shortDate('2026-05-02')).toBe('02/05')
    expect(shortDate('raro')).toBe('raro')
  })
})

describe('faltas a la materia', () => {
  const counts = (absent: number, justified: number, late: number, classes: number) => ({ absent, justified, late, classes })

  it('el resumen de la fila, con las clases como base', () => {
    expect(subjectAbsenceSummary(counts(2, 1, 0, 20))).toBe('3 faltas en 20 clases')
    expect(subjectAbsenceSummary(counts(0, 0, 0, 1))).toBe('Sin faltas en 1 clase')
    expect(subjectAbsenceSummary(counts(1, 0, 2, 20))).toBe('1 falta en 20 clases · 2 tardes')
    expect(subjectAbsenceSummary(counts(0, 0, 0, 0))).toBe('Sin listas')
    expect(subjectAbsenceSummary(null)).toBe('Sin listas')
  })

  it('el detalle desplegado', () => {
    expect(subjectAbsenceDetail(counts(2, 1, 1, 20))).toBe('2 sin justificar, 1 justificada y 1 llegada tarde, de 20 clases con lista.')
    expect(subjectAbsenceDetail(counts(0, 2, 0, 20))).toBe('2 justificadas, de 20 clases con lista.')
    expect(subjectAbsenceDetail(counts(0, 0, 0, 5))).toBe('Sin faltas, de 5 clases con lista.')
    expect(subjectAbsenceDetail(null)).toBe('Todavía no se pasó lista con el alumno.')
  })
})

describe('schoolAbsenceSummary', () => {
  it('las fictas, lo que dice el boletín y el desglose por día', () => {
    expect(schoolAbsenceSummary({ hundredths: 1450, whole: 14, unjustified: 9, justified: 1, lates: 3 })).toEqual({
      total: '14,5',
      reportCard: 14,
      parts: [
        { count: 9, label: 'días sin justificar' },
        { count: 1, label: 'día justificado' },
        { count: 3, label: 'llegadas tarde' },
      ],
    })
  })

  it('en singular', () => {
    const { parts } = schoolAbsenceSummary({ hundredths: 100, whole: 1, unjustified: 1, justified: 2, lates: 1 })
    expect(parts.map((p) => p.label)).toEqual(['día sin justificar', 'días justificados', 'llegada tarde'])
  })
})

describe('neighbors', () => {
  const all = ['a', 'b', 'c', 'd'].map((studentId) => ({ studentId }))

  it('el anterior y el siguiente de la lista que se ve', () => {
    const visible = [all[0], all[2], all[3]]
    expect(neighbors(visible, all, 'c')).toEqual({ previous: all[0], next: all[3] })
    expect(neighbors(visible, all, 'a')).toEqual({ previous: null, next: all[2] })
  })

  it('si el alumno salió del filtro, sigue desde su lugar', () => {
    expect(neighbors([all[0], all[3]], all, 'b')).toEqual({ previous: all[0], next: all[3] })
  })

  it('un alumno que no está en el grupo no tiene vecinos', () => {
    expect(neighbors(all, all, 'z')).toEqual({ previous: null, next: null })
  })
})

describe('subjectCounts', () => {
  const subject = (over: Partial<MeetingStudentSubject>) => ({ valueHundredths: 700, previousValueHundredths: null, descriptor: null, ...over }) as MeetingStudentSubject
  it('cuántas en alerta, sin R y que bajaron', () => {
    expect(
      subjectCounts([
        subject({ descriptor: { label: 'En proceso', descriptor: null, colorToken: null, iconToken: null, isAlert: true }, valueHundredths: 300, previousValueHundredths: 600 }),
        subject({ valueHundredths: null }),
        subject({ previousValueHundredths: 500 }),
      ]),
    ).toEqual({ alert: 1, pending: 1, declined: 1 })
  })
})

describe('juicios de la reunión', () => {
  const ana = { id: 's1', firstName: 'A', lastName: 'B' }
  const rows = [
    { id: 'g1', decision: 'a', createdAt: '2026-06-01', student: null, createdBy: null },
    { id: 'g2', decision: 'b', createdAt: '2026-06-05', student: null, createdBy: null },
    { id: 'a1', decision: 'c', createdAt: '2026-06-02', student: ana, createdBy: null },
  ]

  it('el vigente es el más reciente por alumno y el del grupo aparte', () => {
    expect([...currentDecisionIds(rows)].sort()).toEqual(['a1', 'g2'])
    expect(currentByKey(rows).get(null)?.id).toBe('g2')
  })

  it('quiénes tienen juicio y si está el del grupo', () => {
    expect(judgementState(currentByKey(rows))).toEqual({ studentIds: new Set(['s1']), group: true })
    expect(judgementState(currentByKey([]))).toEqual({ studentIds: new Set(), group: false })
  })

  it('la ruta lleva la orientación sólo si la hay', () => {
    expect(meetingRecordsPath('off-1', null, 'p-1')).toBe('/admin/gradebook/meeting-records?courseOfferingId=off-1&periodId=p-1')
    expect(meetingRecordsPath('off-1', 'co-1', 'p-1')).toContain('courseOrientationId=co-1')
  })
})
