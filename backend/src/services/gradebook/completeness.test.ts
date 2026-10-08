import { describe, expect, it } from 'vitest'
import {
  completionRequestBody,
  countMissingAssessmentGrades,
  countStudentsWithoutGrades,
  isStageComplete,
  missingAfterMeeting,
  sortByUrgency,
  stageDetail,
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

  it('una nota suelta no se cruza contra todo el grupo', () => {
    // Antes cada nota cargada desde la carta sumaba "2 notas sin cargar" con un grupo de 3.
    const sueltas = ['a', 'b', 'c'].map((id) => ({ scope: 'INDIVIDUAL' as const, grades: [grade(id)] }))
    expect(countMissingAssessmentGrades(sueltas, roster)).toBe(0)
  })
})

describe('countStudentsWithoutGrades', () => {
  const roster = new Set(['a', 'b', 'c'])
  const grade = (studentId: string, over: Partial<{ valueHundredths: number | null; isAbsent: boolean }> = {}) => ({
    studentId,
    valueHundredths: 700,
    isAbsent: false,
    ...over,
  })

  it('con sólo notas sueltas, cuenta los alumnos que no tienen ninguna', () => {
    const assessments = [
      { scope: 'INDIVIDUAL' as const, grades: [grade('a')] },
      { scope: 'INDIVIDUAL' as const, grades: [grade('b', { valueHundredths: null, isAbsent: true })] },
    ]
    expect(countStudentsWithoutGrades(assessments, roster)).toBe(1)
  })

  it('una fila vacía o de un alumno dado de baja no cuenta', () => {
    const assessments = [{ scope: 'INDIVIDUAL' as const, grades: [grade('a', { valueHundredths: null }), grade('baja')] }]
    expect(countStudentsWithoutGrades(assessments, roster)).toBe(3)
  })

  it('con una evaluación del grupo no suma: el alumno sin notas ya falta en ella', () => {
    const assessments = [{ grades: [grade('a')] }, { scope: 'INDIVIDUAL' as const, grades: [grade('b')] }]
    expect(countStudentsWithoutGrades(assessments, roster)).toBe(0)
    expect(countMissingAssessmentGrades(assessments, roster)).toBe(2)
  })
})

describe('alumnos sin notas en el control', () => {
  it('lo dejan incompleto y el aviso lo dice', () => {
    const s = summarize(row({ studentsWithoutGrades: 2 }))
    expect(s.complete).toBe(false)
    expect(completionRequestBody(s, 'Mayo')).toBe('Mayo: 2 alumnos sin notas en el tramo.')
  })

  it('sin evaluaciones no los cuenta aparte: ya se avisa eso', () => {
    const s = summarize(row({ assessmentCount: 0, studentsWithoutGrades: 20 }))
    expect(s.studentsWithoutGrades).toBe(0)
    expect(completionRequestBody(s, 'Mayo')).toBe('Mayo: no hay evaluaciones cargadas.')
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

describe('después de la reunión', () => {
  it('lo que falta es la R de cada alumno y cerrar el período', () => {
    const summary = summarize(row({ meetingGradedCount: 18 }))
    expect(summary.missingMeetingGrades).toBe(2)
    expect(missingAfterMeeting(summary)).toEqual(['2 sin nota de reunión (R)', 'falta cerrar el período'])
    expect(completionRequestBody(summary, '1.ª Entrega', 'after')).toBe(
      '1.ª Entrega: 2 sin nota de reunión (R) y falta cerrar el período.',
    )
  })

  it('una reunión sin C (APE) no pide R', () => {
    expect(summarize(row({ requiresGrade: false, meetingGradedCount: 0 })).missingMeetingGrades).toBe(0)
  })

  it('está al día recién cuando cerró el período', () => {
    const open = summarize(row({ meetingGradedCount: 20 }))
    const closed = summarize(row({ meetingGradedCount: 20, periodStatus: 'CLOSED' }))
    expect(isStageComplete(open, 'before')).toBe(true)
    expect(isStageComplete(open, 'after')).toBe(false)
    expect(isStageComplete(closed, 'after')).toBe(true)
    expect(stageDetail(closed, 'after')).toBe('la libreta está cerrada')
  })
})
