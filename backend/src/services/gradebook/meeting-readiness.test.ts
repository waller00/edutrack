import { describe, expect, it } from 'vitest'
import { countMissingAssessmentGrades, meetingReadiness, missingAssessmentSlots, studentsWithoutGrades, type AssessmentWithGrades } from './meeting-readiness.js'
import { summarize, type GradeBookCompleteness } from './completeness.js'

const BOLETIN = { isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true }
const APE = { isMeeting: true, requiresGeneralGrade: false, requiresConceptualJudgement: false }

const student = (studentId: string, over: Record<string, unknown> = {}) => ({
  studentId,
  lastName: studentId.toUpperCase(),
  firstName: studentId,
  assessmentValues: [],
  meetingValueHundredths: 800,
  conductValueHundredths: 800,
  conceptualJudgement: 'Bien.',
  ...over,
})

const grade = (studentId: string, over: Record<string, unknown> = {}) => ({ studentId, valueHundredths: 700, isAbsent: false, ...over })
const group = (...grades: AssessmentWithGrades['grades'][number][]): AssessmentWithGrades => ({ scope: 'GROUP', grades })
const single = (studentId: string): AssessmentWithGrades => ({ scope: 'INDIVIDUAL', grades: [grade(studentId)] })

const roster = [student('ana'), student('beto')]

describe('meetingReadiness', () => {
  it('con todo cargado no falta nada; «no rindió» cuenta como cargado', () => {
    const blockers = meetingReadiness({
      rules: BOLETIN,
      students: roster,
      groupReport: 'El grupo avanzó.',
      assessments: [group(grade('ana'), grade('beto', { valueHundredths: null, isAbsent: true }))],
    })
    expect(blockers).toEqual([])
  })

  it('una evaluación del grupo sin nota para alguien bloquea, con a quién y cuántas', () => {
    const blockers = meetingReadiness({
      rules: BOLETIN,
      students: roster,
      groupReport: 'Ok',
      assessments: [group(grade('ana')), group()],
    })
    expect(blockers).toEqual([{ code: 'MISSING_ASSESSMENT_GRADES', studentIds: ['beto', 'ana'], slots: 3 }])
  })

  it('con sólo notas sueltas, falta quien no tiene ninguna', () => {
    const blockers = meetingReadiness({ rules: BOLETIN, students: roster, groupReport: 'Ok', assessments: [single('ana')] })
    expect(blockers).toEqual([{ code: 'STUDENTS_WITHOUT_GRADES', studentIds: ['beto'] }])
  })

  it('sin evaluaciones en los tramos, eso solo; y va antes que R, C y juicio', () => {
    const blockers = meetingReadiness({
      rules: BOLETIN,
      students: [student('ana', { meetingValueHundredths: null })],
      groupReport: 'Ok',
      assessments: [],
    })
    expect(blockers.map((b) => b.code)).toEqual(['NO_ASSESSMENTS', 'MISSING_GRADES'])
  })

  it('las evaluaciones sólo cuentan en las reuniones de boletín, y si se cargaron', () => {
    expect(meetingReadiness({ rules: APE, students: roster, assessments: [] })).toEqual([])
    expect(meetingReadiness({ rules: BOLETIN, students: roster, groupReport: 'Ok' })).toEqual([])
  })

  it('un alumno que ya no está en el grupo no tapa a uno que sí', () => {
    const slots = missingAssessmentSlots([group(grade('ana'), grade('baja'))], new Set(['ana', 'beto']))
    expect([...slots]).toEqual([['beto', 1]])
    expect(studentsWithoutGrades([single('baja')], new Set(['ana']))).toEqual(['ana'])
  })
})

describe('el control y el cierre dicen lo mismo', () => {
  const ids = new Set(roster.map((s) => s.studentId))
  const row = (assessments: AssessmentWithGrades[]): GradeBookCompleteness => ({
    gradeBookId: 'gb',
    subjectName: 'Matemática',
    courseName: '1.º A',
    teacherUserId: 't',
    teacherName: 'T',
    periodStatus: 'OPEN',
    rosterSize: 2,
    gradedCount: 2,
    requiresGrade: true,
    judgedCount: 2,
    requiresJudgement: true,
    conductCount: 2,
    requiresConduct: true,
    hasGroupReport: true,
    requiresGroupReport: true,
    expectsAssessments: true,
    assessmentCount: assessments.length,
    missingAssessmentGrades: countMissingAssessmentGrades(assessments, ids),
    studentsWithoutGrades: studentsWithoutGrades(assessments, ids).length,
  })

  it.each([
    ['todo cargado', [group(grade('ana'), grade('beto'))]],
    ['una nota sin cargar', [group(grade('ana'))]],
    ['sólo sueltas, a uno le falta', [single('ana')]],
    ['sin evaluaciones', []],
  ])('%s', (_name, assessments) => {
    const complete = summarize(row(assessments)).complete
    const ready = meetingReadiness({ rules: BOLETIN, students: roster, groupReport: 'Ok', assessments }).length === 0
    expect(ready).toBe(complete)
  })
})
