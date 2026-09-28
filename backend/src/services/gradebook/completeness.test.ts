import { describe, expect, it } from 'vitest'
import {
  completionRequestBody,
  countMissingAssessmentGrades,
  sortByUrgency,
  summarize,
  type GradeBookCompleteness,
} from './completeness.js'

function row(over: Partial<GradeBookCompleteness> = {}): GradeBookCompleteness {
  return {
    gradeBookId: 'gb-1',
    subjectName: 'Matemática',
    courseName: '1 EMS',
    teacherUserId: 'u-1',
    teacherName: 'Ana Benítez',
    periodStatus: 'OPEN',
    rosterSize: 20,
    gradedCount: 20,
    requiresGrade: true,
    judgedCount: 20,
    requiresJudgement: true,
    meetingGradedCount: 0,
    expectsAssessments: true,
    assessmentCount: 3,
    missingAssessmentGrades: 0,
    ...over,
  }
}

describe('summarize', () => {
  it('con evaluaciones, C y juicio cargados, está lista para la reunión', () => {
    expect(summarize(row())).toMatchObject({ missingGrades: 0, missingJudgements: 0, hasNoAssessments: false, complete: true })
  })

  it('la R no se exige: se pone en la reunión misma', () => {
    expect(summarize(row({ meetingGradedCount: 0 })).complete).toBe(true)
  })

  it('cuenta lo que falta de C y juicio', () => {
    const s = summarize(row({ gradedCount: 14, judgedCount: 11 }))
    expect(s).toMatchObject({ missingGrades: 6, missingJudgements: 9, complete: false })
  })

  it('el juicio no falta si el período no lo pide; la C tampoco', () => {
    const s = summarize(row({ judgedCount: 0, requiresJudgement: false, gradedCount: 0, requiresGrade: false }))
    expect(s).toMatchObject({ missingJudgements: 0, missingGrades: 0, complete: true })
  })

  it('sin evaluaciones en los tramos de la reunión no está al día', () => {
    const s = summarize(row({ assessmentCount: 0 }))
    expect(s).toMatchObject({ hasNoAssessments: true, complete: false })
  })

  it('notas de evaluación sin cargar la dejan incompleta', () => {
    expect(summarize(row({ missingAssessmentGrades: 4 })).complete).toBe(false)
  })

  it('si la reunión no informa tramos (diagnóstico), no se exigen evaluaciones', () => {
    const s = summarize(row({ expectsAssessments: false, assessmentCount: 0, missingAssessmentGrades: 5 }))
    expect(s).toMatchObject({ hasNoAssessments: false, missingAssessmentGrades: 0, complete: true })
  })

  it('cerrada cuenta como completa aunque falten cosas', () => {
    expect(summarize(row({ periodStatus: 'CLOSED', gradedCount: 0, assessmentCount: 0 })).complete).toBe(true)
  })
})

describe('countMissingAssessmentGrades', () => {
  const roster = new Set(['a', 'b', 'c'])
  const grade = (studentId: string, over: Partial<{ valueHundredths: number | null; isAbsent: boolean; scaleLevelId: string | null }> = {}) => ({
    studentId,
    valueHundredths: 700,
    isAbsent: false,
    scaleLevelId: null,
    ...over,
  })

  it('por evaluación, cuenta alumnos del grupo sin nota', () => {
    expect(countMissingAssessmentGrades([{ grades: [grade('a')] }, { grades: [grade('a'), grade('b')] }], roster)).toBe(3)
  })

  it('"no rindió" y el tramo de una escala ordinal cuentan como cargados', () => {
    const grades = [grade('a', { valueHundredths: null, isAbsent: true }), grade('b', { valueHundredths: null, scaleLevelId: 'lvl' }), grade('c')]
    expect(countMissingAssessmentGrades([{ grades }], roster)).toBe(0)
  })

  it('una fila sin valor no cuenta, y un alumno dado de baja no tapa a uno del grupo', () => {
    const grades = [grade('a', { valueHundredths: null }), grade('baja'), grade('b'), grade('c')]
    expect(countMissingAssessmentGrades([{ grades }], roster)).toBe(1)
  })
})

describe('sortByUrgency', () => {
  it('primero lo incompleto, y entre lo incompleto lo que más falta', () => {
    const rows = [
      summarize(row({ gradeBookId: 'ok' })),
      summarize(row({ gradeBookId: 'poco', gradedCount: 19 })),
      summarize(row({ gradeBookId: 'mucho', gradedCount: 2, missingAssessmentGrades: 10 })),
    ]
    expect(sortByUrgency(rows).map((r) => r.gradeBookId)).toEqual(['mucho', 'poco', 'ok'])
  })

  it('a igual faltante, por materia', () => {
    const rows = [
      summarize(row({ gradeBookId: 'b', subjectName: 'Historia', gradedCount: 19 })),
      summarize(row({ gradeBookId: 'a', subjectName: 'Biología', gradedCount: 19 })),
    ]
    expect(sortByUrgency(rows).map((r) => r.subjectName)).toEqual(['Biología', 'Historia'])
  })
})

describe('completionRequestBody', () => {
  it('dice qué falta y cuánto', () => {
    const s = summarize(row({ gradedCount: 14, judgedCount: 11, missingAssessmentGrades: 5 }))
    expect(completionRequestBody(s, '1.ª Entrega')).toBe(
      '1.ª Entrega: 5 notas de evaluación sin cargar, 6 sin calificación del período y 9 sin juicio conceptual.',
    )
  })

  it('avisa cuando no hay evaluaciones', () => {
    expect(completionRequestBody(summarize(row({ assessmentCount: 0 })), 'Mayo')).toBe('Mayo: no hay evaluaciones cargadas.')
  })

  it('en singular cuando falta una sola nota', () => {
    expect(completionRequestBody(summarize(row({ missingAssessmentGrades: 1 })), 'Mayo')).toBe(
      'Mayo: 1 nota de evaluación sin cargar.',
    )
  })

  it('completa, lo dice', () => {
    expect(completionRequestBody(summarize(row()), 'Mayo')).toBe('Mayo: la libreta está completa.')
  })
})
