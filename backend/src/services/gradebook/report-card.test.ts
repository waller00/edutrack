import { describe, expect, it } from 'vitest'
import {
  buildReportCard,
  studentMeetingJudgement,
  reportCardColumnLabel,
  reportCardSubject,
  reportCardWindow,
} from './report-card.js'

describe('buildReportCard', () => {
  const base = {
    student: { firstName: 'Orazio', lastName: 'Liesegang Rodríguez' },
    group: { courseName: '7.º', orientationName: null, schoolYearLabel: '2026' },
    period: { name: '3.ª Entrega', columnLabel: 'Ago-Set', judgementLabel: 'Informe de actuación' },
    subjects: [],
    meeting: { conductValueHundredths: null, performanceValueHundredths: null, judgement: null },
  }

  it('el total de faltas redondea para abajo: 2 injustificadas y 1 justificada son 2', () => {
    const card = buildReportCard({ ...base, attendance: { absenceHundredths: 250, justified: 1, unjustified: 2, lates: 0, untilYmd: null } })
    expect(card.absenceTotal).toBe(2)
  })

  it('con 2 justificadas las medias juntan una entera: 3', () => {
    const card = buildReportCard({ ...base, attendance: { absenceHundredths: 300, justified: 2, unjustified: 2, lates: 0, untilYmd: null } })
    expect(card.absenceTotal).toBe(3)
  })

  it('una sola media falta todavía no es una falta', () => {
    const card = buildReportCard({ ...base, attendance: { absenceHundredths: 50, justified: 1, unjustified: 0, lates: 0, untilYmd: null } })
    expect(card.absenceTotal).toBe(0)
  })
})

describe('reportCardSubject', () => {
  const grade = {
    studentId: 'st-1',
    valueHundredths: 900,
    meetingValueHundredths: 700,
    conductValueHundredths: 600,
    conceptualJudgement: '  Trabaja de forma aceptable.  ',
  }

  it('de una libreta cerrada toma C, R y el informe', () => {
    expect(reportCardSubject('Matemática', { status: 'CLOSED', grades: [grade] }, 'st-1')).toEqual({
      subjectName: 'Matemática',
      closed: true,
      conductValueHundredths: 600,
      valueHundredths: 700,
      conceptualJudgement: 'Trabaja de forma aceptable.',
    })
  })

  it('va R, nunca la C vieja del docente', () => {
    const subject = reportCardSubject('Historia', { status: 'CLOSED', grades: [{ ...grade, meetingValueHundredths: null }] }, 'st-1')
    expect(subject.valueHundredths).toBeNull()
  })

  it.each(['OPEN', 'REOPENED'])('sin cierre (%s) no imprime nada aunque haya notas cargadas', (status) => {
    expect(reportCardSubject('Matemática', { status, grades: [grade] }, 'st-1')).toEqual({
      subjectName: 'Matemática',
      closed: false,
      conductValueHundredths: null,
      valueHundredths: null,
      conceptualJudgement: null,
    })
  })

  it('una libreta sin estado del período queda pendiente', () => {
    expect(reportCardSubject('Matemática', undefined, 'st-1').closed).toBe(false)
  })

  it('cerrada, pero sin fila del alumno: cerrada y vacía', () => {
    expect(reportCardSubject('Matemática', { status: 'CLOSED', grades: [grade] }, 'st-2')).toMatchObject({
      closed: true,
      valueHundredths: null,
      conceptualJudgement: null,
    })
  })
})

describe('studentMeetingJudgement', () => {
  const at = (iso: string) => new Date(iso)

  it('toma la decisión más reciente sobre el alumno', () => {
    const records = [
      { studentId: 'st-1', decision: 'Vieja.', createdAt: at('2026-09-01') },
      { studentId: 'st-1', decision: ' Valoramos su cambio de actitud. ', createdAt: at('2026-10-01') },
      { studentId: null, decision: 'Del grupo.', createdAt: at('2026-10-05') },
    ]
    expect(studentMeetingJudgement(records, 'st-1')).toBe('Valoramos su cambio de actitud.')
  })

  it('el juicio general del grupo nunca pasa por el del alumno', () => {
    // Es de la reunión, no de la familia: el boletín no lo imprime aunque el alumno no tenga uno.
    const records = [
      { studentId: 'st-2', decision: 'De otro.', createdAt: at('2026-10-01') },
      { studentId: null, decision: 'Del grupo.', createdAt: at('2026-10-05') },
    ]
    expect(studentMeetingJudgement(records, 'st-1')).toBeNull()
  })

  it('sin ninguno, null: la fila queda en blanco', () => {
    expect(studentMeetingJudgement([], 'st-1')).toBeNull()
  })
})

describe('reportCardWindow', () => {
  const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`)
  const tramo = (id: string, sortOrder: number, from: string | null, to: string | null) => ({
    id,
    kind: 'TRAMO',
    sortOrder,
    startsOn: from ? day(from) : null,
    endsOn: to ? day(to) : null,
  })
  const entrega = (id: string, sortOrder: number) => ({
    id,
    kind: 'ENTREGA',
    sortOrder,
    startsOn: day('2026-09-15'),
    endsOn: day('2026-10-15'),
  })

  it('una entrega informa los días de los tramos que cubre', () => {
    const periods = [
      tramo('mayo-junio', 40, '2026-05-01', '2026-06-30'),
      tramo('julio', 50, '2026-07-01', '2026-07-31'),
      entrega('e2', 60),
      tramo('ago-set', 70, '2026-08-01', '2026-09-30'),
      entrega('e3', 80),
    ]
    expect(reportCardWindow(periods[4], periods)).toEqual({ fromYmd: '2026-08-01', toYmd: '2026-09-30' })
    expect(reportCardWindow(periods[2], periods)).toEqual({ fromYmd: '2026-05-01', toYmd: '2026-07-31' })
  })

  it('un semestre (tramo con reunión) se informa a sí mismo', () => {
    const semestre = tramo('s1', 10, '2026-03-01', '2026-07-15')
    expect(reportCardWindow(semestre, [semestre])).toEqual({ fromYmd: '2026-03-01', toYmd: '2026-07-15' })
  })

  it('si a un tramo le faltan fechas usa las del propio período', () => {
    const periods = [tramo('ago-set', 70, null, null), entrega('e3', 80)]
    expect(reportCardWindow(periods[1], periods)).toEqual({ fromYmd: '2026-09-15', toYmd: '2026-10-15' })
  })

  it('sin ninguna fecha, null: todo el ciclo', () => {
    const sinFechas = tramo('s1', 10, null, null)
    expect(reportCardWindow(sinFechas, [sinFechas])).toBeNull()
  })
})

describe('reportCardColumnLabel', () => {
  it('los meses que informa, como la planilla', () => {
    expect(reportCardColumnLabel({ fromYmd: '2026-08-01', toYmd: '2026-09-30' }, 'x')).toBe('Ago-Set')
    expect(reportCardColumnLabel({ fromYmd: '2026-03-01', toYmd: '2026-07-15' }, 'x')).toBe('Mar-Jul')
  })

  it('un solo mes no se repite', () => {
    expect(reportCardColumnLabel({ fromYmd: '2026-07-01', toYmd: '2026-07-31' }, 'x')).toBe('Jul')
  })

  it('sin fechas, el nombre del período', () => {
    expect(reportCardColumnLabel(null, '1.ª Entrega')).toBe('1.ª Entrega')
  })
})
