import { describe, expect, it } from 'vitest'
import {
  buildReportCard,
  formatAverage,
  pendingSubjectCount,
  reportCardAverage,
  type ReportCardSubject,
} from './report-card.js'

function subject(over: Partial<ReportCardSubject> = {}): ReportCardSubject {
  return {
    subjectName: 'Matemática',
    teacherName: 'Ana Benítez',
    valueHundredths: 800,
    descriptor: null,
    conceptualJudgement: null,
    conductValueHundredths: null,
    ...over,
  }
}

describe('reportCardAverage', () => {
  it('promedia las asignaturas calificadas', () => {
    expect(reportCardAverage([subject({ valueHundredths: 600 }), subject({ valueHundredths: 800 })])).toBe(700)
  })

  it('una asignatura sin nota NO arrastra el promedio hacia abajo', () => {
    // "Todavía no tiene nota" no es "sacó cero": promediar el hueco sería mentir sobre el alumno.
    const conHueco = [subject({ valueHundredths: 800 }), subject({ valueHundredths: null })]
    expect(reportCardAverage(conHueco)).toBe(800)
  })

  it('sin ninguna nota devuelve null, no cero', () => {
    expect(reportCardAverage([subject({ valueHundredths: null })])).toBeNull()
    expect(reportCardAverage([])).toBeNull()
  })

  it('redondea en centésimos', () => {
    expect(reportCardAverage([subject({ valueHundredths: 601 }), subject({ valueHundredths: 700 })])).toBe(651)
  })
})

describe('formatAverage', () => {
  it('siempre lleva al menos un decimal: hace falta para escolaridad y abanderados', () => {
    expect(formatAverage(700)).toBe('7,0')
    expect(formatAverage(783)).toBe('7,8')
    // Pedir cero decimales no debe poder achatar el desempate.
    expect(formatAverage(700, 0)).toBe('7,0')
  })

  it('acepta más decimales si la escala los tiene', () => {
    expect(formatAverage(783, 2)).toBe('7,83')
  })

  it('sin promedio muestra un guion, no un cero', () => {
    expect(formatAverage(null)).toBe('—')
  })
})

describe('pendingSubjectCount', () => {
  it('cuenta las asignaturas sin nota, que son las que explican un promedio parcial', () => {
    expect(pendingSubjectCount([subject(), subject({ valueHundredths: null })])).toBe(1)
    expect(pendingSubjectCount([subject()])).toBe(0)
  })
})

describe('buildReportCard', () => {
  const base = {
    student: { firstName: 'Ana', lastName: 'Díaz', documentId: '51234561', birthDate: null },
    group: { courseName: 'Primero', orientationName: null, schoolYearLabel: '2026' },
    period: { name: 'Mayo' },
    conductValueHundredths: 300,
    attendance: { absenceHundredths: 150, justifiedCount: 1 },
  }

  it('arma el boletín con promedio y pendientes calculados', () => {
    const card = buildReportCard({
      ...base,
      subjects: [subject({ valueHundredths: 800 }), subject({ subjectName: 'Historia', valueHundredths: null })],
    })

    expect(card.averageHundredths).toBe(800)
    expect(card.pendingCount).toBe(1)
    // Lo que vino se conserva tal cual: el boletín no recalcula conducta ni faltas.
    expect(card.conductValueHundredths).toBe(300)
    expect(card.attendance).toEqual({ absenceHundredths: 150, justifiedCount: 1 })
  })
})
