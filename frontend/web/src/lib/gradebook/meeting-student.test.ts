import { describe, expect, it } from 'vitest'
import {
  assessmentChoices,
  assessmentsByTramo,
  correctionReasonError,
  correctionRequest,
  correctionTitle,
  initialCorrection,
  performanceChoices,
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

describe('corrección de administración', () => {
  const numeric = { kind: 'NUMERIC' as const, minValueHundredths: 100, maxValueHundredths: 1000, levels: [] }
  const ordinal = { kind: 'ORDINAL' as const, minValueHundredths: null, maxValueHundredths: null, levels: [{ id: 'l1', label: 'Logrado' }, { id: 'l2', label: 'En proceso' }] }
  const assessment = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    title: 'Escrito 2',
    date: '2026-05-12',
    periodId: 't2',
    periodName: '2.º tramo',
    scope: 'GROUP',
    valueHundredths: 300,
    isAbsent: false,
    levelLabel: null,
    comment: 'Faltó estudiar',
    missing: false,
    scale: numeric,
    scaleLevelId: null,
    ...over,
  })

  it('agrupa las notas del período por tramo, en el orden en que llegan', () => {
    const groups = assessmentsByTramo([
      assessment({ id: 'a', periodId: 't1', periodName: '1.er tramo' }),
      assessment({ id: 'b', periodId: 't2', periodName: '2.º tramo' }),
      assessment({ id: 'c', periodId: 't1', periodName: '1.er tramo' }),
    ] as never)
    expect(groups.map((g) => [g.periodName, g.assessments.map((a) => a.id)])).toEqual([
      ['1.er tramo', ['a', 'c']],
      ['2.º tramo', ['b']],
    ])
  })

  it('las opciones salen de la escala de la evaluación: números o tramos', () => {
    expect(assessmentChoices(numeric, null).map((c) => c.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    // Una nota con decimales sigue en la lista: tocar el selector no la borra.
    expect(assessmentChoices(numeric, 750).map((c) => c.value)).toContain('750')
    expect(assessmentChoices(ordinal, null)).toEqual([{ value: 'l1', label: 'Logrado' }, { value: 'l2', label: 'En proceso' }])
    expect(performanceChoices({ minValueHundredths: 100, maxValueHundredths: 1200 }).at(-1)).toEqual({ value: '1200', label: '12' })
  })

  it('el motivo es obligatorio', () => {
    expect(correctionReasonError('  ')).toBe('Escribí el motivo de la corrección.')
    expect(correctionReasonError('Se cargó mal')).toBeNull()
  })

  it('arranca con lo cargado y dice qué corrige', () => {
    const target = { kind: 'assessment' as const, gradeBookId: 'gb', studentId: 's', assessment: assessment() as never }
    expect(initialCorrection(target)).toEqual({ value: '300', isAbsent: false, comment: 'Faltó estudiar', text: '', reason: '' })
    expect(correctionTitle(target)).toBe('Corregir la nota de «Escrito 2»')
    expect(initialCorrection({ kind: 'assessment', gradeBookId: 'gb', studentId: 's', assessment: assessment({ scale: ordinal, scaleLevelId: 'l2' }) as never }).value).toBe('l2')
    expect(initialCorrection({ kind: 'judgement', gradeBookId: 'gb', periodId: 'p', studentId: 's', current: 'Bien.' }).text).toBe('Bien.')
    expect(correctionTitle({ kind: 'performance', gradeBookId: 'gb', periodId: 'p', studentId: 's', current: 500 })).toBe('Corregir la R')
    expect(correctionTitle({ kind: 'conduct', gradeBookId: 'gb', periodId: 'p', studentId: 's', current: null })).toBe('Corregir la C')
    expect(correctionTitle({ kind: 'judgement', gradeBookId: 'gb', periodId: 'p', studentId: 's', current: null })).toBe('Corregir el juicio del docente')
  })

  it('arma lo que se manda para cada corrección', () => {
    const values = { value: '700', isAbsent: false, comment: '  ', text: '', reason: ' Error de carga ' }
    expect(correctionRequest({ kind: 'assessment', gradeBookId: 'gb', studentId: 's', assessment: assessment() as never }, values)).toEqual({
      path: '/admin/gradebook/corrections/gradebooks/gb/assessments/a1/students/s',
      body: { valueHundredths: 700, scaleLevelId: null, isAbsent: false, comment: null, reason: 'Error de carga' },
    })
    expect(
      correctionRequest({ kind: 'assessment', gradeBookId: 'gb', studentId: 's', assessment: assessment({ scale: ordinal }) as never }, { ...values, value: 'l1' }).body,
    ).toMatchObject({ valueHundredths: null, scaleLevelId: 'l1' })
    expect(correctionRequest({ kind: 'performance', gradeBookId: 'gb', periodId: 'p', studentId: 's', current: 500 }, values)).toEqual({
      path: '/admin/gradebook/corrections/gradebooks/gb/periods/p/students/s',
      body: { meetingValueHundredths: 700, reason: 'Error de carga' },
    })
    expect(correctionRequest({ kind: 'conduct', gradeBookId: 'gb', periodId: 'p', studentId: 's', current: 500 }, { ...values, value: '' }).body).toEqual({
      conductValueHundredths: null,
      reason: 'Error de carga',
    })
    expect(
      correctionRequest({ kind: 'judgement', gradeBookId: 'gb', periodId: 'p', studentId: 's', current: null }, { ...values, text: ' Mejoró. ' }).body,
    ).toEqual({ conceptualJudgement: 'Mejoró.', reason: 'Error de carga' })
  })
})
