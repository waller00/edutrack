import { describe, expect, it } from 'vitest'
import { buildMeetingStudent, type MeetingStudentInput } from './meeting-student.js'

const period = (id: string, kind: string, sortOrder: number, startsOn: string, endsOn: string, reportCard = false) => ({
  id,
  name: id,
  kind,
  sortOrder,
  startsOn: new Date(`${startsOn}T12:00:00.000Z`),
  endsOn: new Date(`${endsOn}T12:00:00.000Z`),
  isMeeting: reportCard,
  requiresGeneralGrade: reportCard,
  requiresConceptualJudgement: reportCard,
})

const T1 = period('T1', 'TRAMO', 10, '2026-03-01', '2026-04-15')
const E1 = period('1.ª Entrega', 'ENTREGA', 15, '2026-04-16', '2026-04-20', true)
const T2 = period('T2', 'TRAMO', 20, '2026-04-21', '2026-06-15')
const E2 = period('2.ª Entrega', 'ENTREGA', 25, '2026-06-16', '2026-06-20', true)
const PERIODS = [T1, E1, T2, E2]

const LEVELS = [
  { id: 'bajo', label: 'En proceso', descriptor: null, minValueHundredths: 100, maxValueHundredths: 499, colorToken: 'orange', iconToken: null, isPassing: false, isAlert: true },
  { id: 'alto', label: 'Logrado', descriptor: null, minValueHundredths: 500, maxValueHundredths: 1000, colorToken: 'lime', iconToken: null, isPassing: true, isAlert: false },
]

const MAT = { id: 'gb-mat', subjectId: 'mat', orientationId: null, courseOrientationId: null, subject: { name: 'Matemática' }, teacher: { name: 'Ana G' } }
const BIO = { id: 'gb-bio', subjectId: 'bio', orientationId: null, courseOrientationId: 'co-1', subject: { name: 'Biología' }, teacher: null }

const grade = (r: number | null, over: Record<string, unknown> = {}) => ({
  valueHundredths: null,
  meetingValueHundredths: r,
  conductValueHundredths: 800,
  conceptualJudgement: 'Trabaja en clase.',
  ...over,
})

const assessment = (id: string, gradeBookId: string, date: string, grades: unknown[], scope = 'GROUP', periodId = 'T2') => ({
  id,
  gradeBookId,
  periodId,
  date: new Date(`${date}T12:00:00.000Z`),
  title: `Evaluación ${id}`,
  scope,
  grades: grades as never,
})

const mark = (status: string, ymd: string, subjectId: string, courseOrientationId: string | null = null) => ({
  status,
  ymd,
  subjectId,
  orientationId: null,
  courseOrientationId,
})

function input(over: Partial<MeetingStudentInput> = {}): MeetingStudentInput {
  return {
    student: { studentId: 's1', lastName: 'García', firstName: 'Marcos' },
    books: [MAT, BIO],
    target: E2,
    previous: E1,
    periods: PERIODS,
    states: [
      { gradeBookId: 'gb-mat', periodId: E2.id, status: 'CLOSED', grades: [grade(300)] },
      { gradeBookId: 'gb-mat', periodId: E1.id, status: 'CLOSED', grades: [grade(500)] },
      { gradeBookId: 'gb-bio', periodId: E2.id, status: 'OPEN', grades: [grade(null, { valueHundredths: 600 })] },
    ],
    assessments: [
      assessment('b', 'gb-mat', '2026-05-20', [{ valueHundredths: null, isAbsent: true, comment: null, scaleLevel: null }]),
      assessment('a', 'gb-mat', '2026-05-02', [{ valueHundredths: 300, isAbsent: false, comment: 'Faltó estudiar', scaleLevel: null }]),
      assessment('c', 'gb-mat', '2026-06-01', []),
      // Una nota individual de otro alumno: no es de este.
      assessment('d', 'gb-mat', '2026-06-02', [], 'INDIVIDUAL'),
    ],
    marks: [
      mark('ABSENT', '2026-05-10', 'mat'),
      mark('LATE', '2026-03-10', 'mat'),
      mark('PRESENT', '2026-05-11', 'mat'),
      // Biología de la orientación: no se mezcla con una Biología de tronco común.
      mark('ABSENT_JUSTIFIED', '2026-05-12', 'bio', 'co-1'),
      mark('ABSENT', '2026-05-13', 'bio', null),
    ],
    levels: LEVELS,
    absences: { absenceHundredths: 1450, justified: 800, lates: 3, counts: { unjustified: 9, justified: 8, lates: 3 } },
    ...over,
  }
}

describe('buildMeetingStudent', () => {
  it('cada materia con su R, su tramo, la C, el juicio y la R de la reunión anterior', () => {
    const [mat, bio] = buildMeetingStudent(input()).subjects
    expect(mat).toMatchObject({
      name: 'Matemática',
      teacher: 'Ana G',
      periodStatus: 'CLOSED',
      valueHundredths: 300,
      conductValueHundredths: 800,
      conceptualJudgement: 'Trabaja en clase.',
      previousValueHundredths: 500,
    })
    expect(mat.descriptor).toMatchObject({ label: 'En proceso', isAlert: true })
    // Sin R todavía: la C vieja queda como propuesta y no hay anterior.
    expect(bio).toMatchObject({ valueHundredths: null, proposedValueHundredths: 600, previousValueHundredths: null, descriptor: null })
  })

  it('las evaluaciones del período en orden, con «No rindió» y las del grupo que no tienen nota', () => {
    const [mat] = buildMeetingStudent(input()).subjects
    expect(mat.assessments.map((a) => [a.id, a.date, a.valueHundredths, a.isAbsent, a.missing])).toEqual([
      ['a', '2026-05-02', 300, false, false],
      ['b', '2026-05-20', null, true, false],
      ['c', '2026-06-01', null, false, true],
    ])
    expect(mat.assessments[0]).toMatchObject({ periodName: 'T2', comment: 'Faltó estudiar' })
  })

  it('las faltas a cada materia salen de sus clases: en el ciclo y en los días que informa la reunión', () => {
    const [mat, bio] = buildMeetingStudent(input()).subjects
    expect(mat.attendance.year).toEqual({ absent: 1, justified: 0, late: 1, classes: 3 })
    // La 2.ª Entrega informa el T2: la llegada tarde de marzo es del T1.
    expect(mat.attendance.period).toEqual({ absent: 1, justified: 0, late: 0, classes: 2 })
    expect(bio.attendance.year).toEqual({ absent: 0, justified: 1, late: 0, classes: 1 })
  })

  it('las faltas del liceo con el desglose y las fictas redondeadas para abajo', () => {
    expect(buildMeetingStudent(input()).absences).toEqual({ hundredths: 1450, whole: 14, unjustified: 9, justified: 8, lates: 3 })
    expect(buildMeetingStudent(input({ absences: undefined })).absences).toEqual({ hundredths: 0, whole: 0, unjustified: 0, justified: 0, lates: 0 })
  })

  it('la reunión y la anterior, con su nombre; sin anterior, null', () => {
    const view = buildMeetingStudent(input())
    expect(view.period).toEqual({ id: E2.id, name: '2.ª Entrega' })
    expect(view.previousPeriod).toEqual({ id: E1.id, name: '1.ª Entrega' })
    expect(buildMeetingStudent(input({ target: E1, previous: null })).previousPeriod).toBeNull()
  })
})
