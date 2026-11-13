import { describe, expect, it } from 'vitest'
import {
  alertSubjectsRule,
  attendanceTrendPoints,
  evolutionParts,
  filterRisk,
  lowSubjectsParts,
  matchesStudent,
  monthLabel,
  monthName,
  parseMotive,
  presentDays,
  riskReasons,
  subjectRanking,
  type AttendanceTrendResponse,
  type LowGradeRow,
  type RiskRow,
} from './student-indicators'

const student = { studentId: 's1', firstName: 'Ana', lastName: 'Pérez', courseName: '7 EBI' }

describe('búsqueda de estudiantes', () => {
  it('busca por nombre, apellido o curso, sin tildes ni mayúsculas', () => {
    expect(matchesStudent(student, 'perez ana')).toBe(true)
    expect(matchesStudent(student, '7 ebi')).toBe(true)
    expect(matchesStudent(student, 'Gómez')).toBe(false)
    expect(matchesStudent(student, '   ')).toBe(true)
  })
})

describe('asistencia en el tiempo', () => {
  const days = (studentDays: number, absentDays: number, justifiedDays = 0, lateDays = 0) => ({ studentDays, absentDays, justifiedDays, lateDays })
  const trend: AttendanceTrendResponse = {
    schoolYear: null,
    months: ['2026-03', '2026-04'],
    byCourse: [
      {
        courseOfferingId: 'o7',
        courseName: '7 EBI',
        level: 'EBI',
        months: [{ month: '2026-03', ...days(100, 10, 4) }, { month: '2026-04', ...days(0, 0) }],
        total: days(100, 10, 4),
      },
    ],
    total: { ...days(300, 30, 12), months: [{ month: '2026-03', ...days(200, 20, 8) }, { month: '2026-04', ...days(100, 10, 4) }] },
  }

  it('nombra los meses como en Uruguay', () => {
    expect(monthName('2026-09')).toBe('setiembre')
    expect(monthLabel('2026-03')).toBe('Mar')
    expect(monthLabel('raro')).toBe('raro')
  })

  it('llegar tarde es que vino: la asistencia descuenta sólo los días con falta', () => {
    expect(presentDays(days(20, 3, 1, 5))).toBe(17)
  })

  it('una fila por mes con la asistencia del liceo, separando justificadas', () => {
    const [march, april] = attendanceTrendPoints(trend)
    expect(march).toEqual({ month: '2026-03', label: 'Mar', liceo: 90, course: null, unjustified: 12, justified: 8, studentDays: 200 })
    expect(april.liceo).toBe(90)
  })

  it('con un curso elegido suma su línea; un mes sin listas queda vacío', () => {
    const [march, april] = attendanceTrendPoints(trend, 'o7')
    expect(march.course).toBe(90)
    expect(april.course).toBeNull()
    expect(attendanceTrendPoints(trend, 'otro')[0].course).toBeNull()
  })
})

describe('ranking de asignaturas con notas bajas', () => {
  const row = (subjectName: string, low: number, graded: number, courseOfferingId = 'o7'): LowGradeRow => ({
    courseOfferingId,
    courseName: courseOfferingId === 'o7' ? '7 EBI' : '8 EBI',
    orientationName: null,
    subjectName,
    graded,
    low,
    percent: null,
    pending: 0,
  })

  it('por curso, de mayor a menor proporción, sin las que no tienen bajas', () => {
    const ranking = subjectRanking(
      {
        rows: [row('Inglés', 2, 30), row('Matemática', 10, 30), row('Física', 10, 25), row('Dibujo', 0, 30), row('Historia', 3, 28, 'o8')],
        courses: [
          { courseOfferingId: 'o7', courseName: '7 EBI', graded: 30, low: 15, percent: 50 },
          { courseOfferingId: 'o8', courseName: '8 EBI', graded: 28, low: 3, percent: 10.7 },
        ],
      },
      2,
    )
    expect(ranking[0].subjects.map((s) => s.subjectName)).toEqual(['Física', 'Matemática'])
    expect(ranking[0].hidden).toBe(1)
    expect(ranking[1].subjects.map((s) => s.subjectName)).toEqual(['Historia'])
  })

  it('a igual proporción, la que tiene más alumnos con nota baja', () => {
    const ranking = subjectRanking({
      rows: [row('Química', 1, 10), row('Biología', 3, 30), row('Arte', 1, 10)],
      courses: [{ courseOfferingId: 'o7', courseName: '7 EBI', graded: 30, low: 5, percent: 16.7 }],
    })
    expect(ranking[0].subjects.map((s) => s.subjectName)).toEqual(['Biología', 'Arte', 'Química'])
  })
})

describe('quién necesita atención', () => {
  const risk = (over: Partial<RiskRow>): RiskRow => ({
    ...student,
    level: 'EBI',
    grades: null,
    absenceHundredths: 0,
    absenceThreshold: null,
    streak: null,
    carried: 0,
    reasons: [],
    families: [],
    ...over,
  })

  it('cada motivo dice su número y de dónde sale', () => {
    const texts = riskReasons(
      risk({
        reasons: ['GRADES', 'CARRIED', 'ABSENCES', 'STREAK'],
        grades: { lowSubjects: 4, subjects: [], periodName: '2.ª Entrega' },
        carried: 2,
        absenceHundredths: 2650,
        absenceThreshold: 2500,
        streak: { days: 5, from: '2026-10-27' },
      }),
    ).map((r) => r.text)
    expect(texts).toEqual([
      'Notas: 4 materias bajas en 2.ª Entrega',
      'Debe 2 materias de años anteriores',
      'Faltas: 26,5 en el año (pasó las 25)',
      'Faltas seguidas: 5 días, sigue faltando',
    ])
  })

  it('en singular cuando es una', () => {
    const texts = riskReasons(risk({ reasons: ['GRADES', 'CARRIED', 'ABSENCES'], grades: { lowSubjects: 1, subjects: [], periodName: '1.ª Entrega' }, carried: 1, absenceHundredths: 1800 }))
    expect(texts.map((r) => r.text)).toEqual([
      'Notas: 1 materia baja en 1.ª Entrega',
      'Debe 1 materia de años anteriores',
      'Faltas: 18 en el año (pasó las 18)',
    ])
    expect(riskReasons(risk({ reasons: ['GRADES', 'STREAK'] })).map((r) => r.text)).toEqual([
      'Notas: 0 materias bajas en el boletín',
      'Faltas seguidas: 0 días, sigue faltando',
    ])
  })

  it('dice en qué materias tiene las notas bajas, no sólo cuántas', () => {
    const text = (subjects: string[]) =>
      riskReasons(risk({ reasons: ['GRADES'], grades: { lowSubjects: subjects.length, subjects, periodName: '3.ª Entrega' } }))[0].text
    expect(text(['Matemática'])).toBe('Notas: 1 materia baja en 3.ª Entrega — Matemática')
    expect(text(['Matemática', 'Física'])).toBe('Notas: 2 materias bajas en 3.ª Entrega — Matemática y Física')
    expect(text(['Biología', 'Física', 'Matemática'])).toBe('Notas: 3 materias bajas en 3.ª Entrega — Biología, Física y Matemática')
  })

  it('filtra por curso, motivo y búsqueda', () => {
    const rows = [
      risk({ studentId: 'n', lastName: 'Notas', families: ['NOTAS'] }),
      risk({ studentId: 'f', lastName: 'Faltas', courseName: '8 EBI', families: ['FALTAS'] }),
      risk({ studentId: 'a', lastName: 'Ambos', families: ['NOTAS', 'FALTAS'] }),
    ]
    const ids = (motive: ReturnType<typeof parseMotive>, course = '', search = '') => filterRisk(rows, { motive, course, search }).map((r) => r.studentId)
    expect(ids('')).toEqual(['n', 'f', 'a'])
    expect(ids('notas')).toEqual(['n', 'a'])
    expect(ids('faltas')).toEqual(['f', 'a'])
    expect(ids('ambos')).toEqual(['a'])
    expect(ids('', '8 EBI')).toEqual(['f'])
    expect(ids('', '', 'ambos')).toEqual(['a'])
  })

  it('un motivo desconocido en la URL es "todos"', () => {
    expect(parseMotive('ambos')).toBe('ambos')
    expect(parseMotive('cualquiera')).toBe('')
    expect(parseMotive(null)).toBe('')
  })
})

describe('rendimiento', () => {
  it('marca desde cuántas materias bajas la reunión los pone en riesgo', () => {
    const parts = lowSubjectsParts({ graded: 10, none: 5, one: 2, two: 2, threeOrMore: 1 }, 2)
    expect(parts.map((p) => [p.label, p.value, Boolean(p.alert)])).toEqual([
      ['Ninguna', 5, false],
      ['1 materia', 2, false],
      ['2 materias', 2, true],
      ['3 o más', 1, true],
    ])
    expect(lowSubjectsParts({ graded: 1, none: 1, one: 0, two: 0, threeOrMore: 0 }, null).some((p) => p.alert)).toBe(false)
  })

  it('la evolución separa a quienes no tienen con qué compararse', () => {
    expect(evolutionParts({ total: 10, improved: 3, declined: 2, compared: 8 }).map((p) => [p.key, p.value])).toEqual([
      ['improved', 3],
      ['same', 3],
      ['declined', 2],
      ['none', 2],
    ])
  })

  it('lee la regla de asignaturas en alerta del ciclo', () => {
    expect(alertSubjectsRule([{ type: 'SCORE_DROP', threshold: 200 }, { type: 'ALERT_SUBJECTS', threshold: 3 }])).toBe(3)
    expect(alertSubjectsRule([])).toBeNull()
    expect(alertSubjectsRule(undefined)).toBeNull()
  })
})
