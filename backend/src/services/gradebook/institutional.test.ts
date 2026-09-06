import { describe, expect, it } from 'vitest'
import {
  buildMatrixRow,
  buildSubjectEvolution,
  DEFAULT_RISK_RULE,
  describeCell,
  gradeBooksForGroup,
  hasSustainedDecline,
  isAtRisk,
  transversalAverage,
  type MatrixCell,
  type StudentHistoryEntry,
} from './institutional.js'

const LEVELS = [
  { id: 'bajo', label: 'Insuficiente', descriptor: 'No alcanza.', minValueHundredths: 100, maxValueHundredths: 599, colorToken: 'red', iconToken: 'alert-triangle', isPassing: false, isAlert: true },
  { id: 'alto', label: 'Logrado', descriptor: 'Alcanza.', minValueHundredths: 600, maxValueHundredths: 1200, colorToken: 'green', iconToken: 'check', isPassing: true, isAlert: false },
]

function cell(over: Partial<MatrixCell> = {}): MatrixCell {
  return {
    gradeBookId: 'gb-1',
    subjectId: 'sub-1',
    valueHundredths: 800,
    conceptualJudgement: null,
    descriptor: describeCell(800, LEVELS),
    periodStatus: 'OPEN',
    pending: false,
    ...over,
  }
}

describe('gradeBooksForGroup', () => {
  const books = [
    { id: 'comun', subjectId: 's1', courseOfferingId: 'off-1', courseOrientationId: null, orientationId: null },
    { id: 'cs-vida', subjectId: 's2', courseOfferingId: 'off-1', courseOrientationId: 'co-vida', orientationId: null },
    { id: 'cs-tec', subjectId: 's3', courseOfferingId: 'off-1', courseOrientationId: 'co-tec', orientationId: null },
    { id: 'otro-curso', subjectId: 's4', courseOfferingId: 'off-2', courseOrientationId: null, orientationId: null },
  ]

  it('un grupo con orientación cursa las suyas MÁS las de tronco común', () => {
    // Quedarse sólo con las de la orientación dejaría la matriz sin la mitad de las asignaturas.
    const found = gradeBooksForGroup(books, { courseOfferingId: 'off-1', orientationId: null, courseOrientationId: 'co-vida' })
    expect(found.map((b) => b.id).sort()).toEqual(['comun', 'cs-vida'])
  })

  it('un grupo sin orientación cursa sólo el tronco común', () => {
    const found = gradeBooksForGroup(books, { courseOfferingId: 'off-1', orientationId: null, courseOrientationId: null })
    expect(found.map((b) => b.id)).toEqual(['comun'])
  })

  it('nunca cruza cursos', () => {
    const found = gradeBooksForGroup(books, { courseOfferingId: 'off-1', orientationId: null, courseOrientationId: 'co-vida' })
    expect(found.some((b) => b.id === 'otro-curso')).toBe(false)
  })

  it('una libreta con orientationId del catálogo no cae en un grupo sin orientación', () => {
    const withOrientation = [{ id: 'x', subjectId: 's', courseOfferingId: 'off-1', courseOrientationId: null, orientationId: 'o-vida' }]
    expect(gradeBooksForGroup(withOrientation, { courseOfferingId: 'off-1', orientationId: null, courseOrientationId: null })).toEqual([])
    expect(gradeBooksForGroup(withOrientation, { courseOfferingId: 'off-1', orientationId: 'o-vida', courseOrientationId: null })).toHaveLength(1)
  })
})

describe('transversalAverage', () => {
  it('promedia sólo lo calificado', () => {
    expect(transversalAverage([cell({ valueHundredths: 600 }), cell({ valueHundredths: 800 })])).toBe(700)
  })

  it('una asignatura pendiente NO arrastra el promedio', () => {
    // "Todavía no tiene nota" no es lo mismo que "sacó poco".
    const cells = [cell({ valueHundredths: 800 }), cell({ valueHundredths: null, pending: true })]
    expect(transversalAverage(cells)).toBe(800)
  })

  it('sin ninguna nota devuelve null', () => {
    expect(transversalAverage([cell({ valueHundredths: null })])).toBeNull()
  })
})

describe('buildMatrixRow', () => {
  it('cuenta pendientes y alertas', () => {
    const row = buildMatrixRow({
      student: { studentId: 's1', lastName: 'B', firstName: 'Ana' },
      cells: [
        cell({ valueHundredths: 300, descriptor: describeCell(300, LEVELS) }),
        cell({ valueHundredths: 800 }),
        cell({ valueHundredths: null, descriptor: null, pending: true }),
      ],
    })
    expect(row).toMatchObject({ pendingCount: 1, alertCount: 1, averageHundredths: 550 })
  })
})

describe('isAtRisk', () => {
  it('marca a partir del umbral de asignaturas en alerta', () => {
    expect(isAtRisk({ alertCount: 3 })).toBe(true)
    expect(isAtRisk({ alertCount: 2 })).toBe(false)
  })

  it('el umbral es configurable, no está clavado', () => {
    expect(isAtRisk({ alertCount: 2 }, { alertSubjectsThreshold: 2 })).toBe(true)
    expect(DEFAULT_RISK_RULE.alertSubjectsThreshold).toBe(3)
  })
})

describe('buildSubjectEvolution', () => {
  function entry(over: Partial<StudentHistoryEntry>): StudentHistoryEntry {
    return {
      schoolYearCode: 2026, schoolYearLabel: '2026', courseName: '3 EMS', orientationName: null,
      periodCode: 'MAR_ABR', periodName: 'Marzo-Abril', periodSortOrder: 10,
      subjectName: 'Matemática', valueHundredths: 700, conceptualJudgement: null,
      ...over,
    }
  }

  it('ordena los períodos por su orden, no alfabéticamente', () => {
    const evolution = buildSubjectEvolution([
      entry({ periodCode: 'MAYO', periodName: 'Mayo', periodSortOrder: 20, valueHundredths: 800 }),
      entry({ periodCode: 'MAR_ABR', periodSortOrder: 10, valueHundredths: 600 }),
    ])
    expect(evolution[0].points.map((p) => p.periodCode)).toEqual(['MAR_ABR', 'MAYO'])
  })

  it('conserva el período sin datos como hueco, no lo omite', () => {
    // Borrarlo haría que dos períodos separados parecieran consecutivos.
    const evolution = buildSubjectEvolution([
      entry({ periodCode: 'MAR_ABR', periodSortOrder: 10, valueHundredths: 600 }),
      entry({ periodCode: 'MAYO', periodName: 'Mayo', periodSortOrder: 20, subjectName: 'Historia', valueHundredths: 900 }),
    ])
    const mate = evolution.find((e) => e.subjectName === 'Matemática')!
    expect(mate.points).toHaveLength(2)
    expect(mate.points[1].valueHundredths).toBeNull()
  })

  it('agrupa por asignatura en orden alfabético', () => {
    const evolution = buildSubjectEvolution([
      entry({ subjectName: 'Química' }),
      entry({ subjectName: 'Biología' }),
    ])
    expect(evolution.map((e) => e.subjectName)).toEqual(['Biología', 'Química'])
  })
})

describe('hasSustainedDecline', () => {
  it('exige tres bajas consecutivas', () => {
    expect(hasSustainedDecline([{ valueHundredths: 900 }, { valueHundredths: 700 }, { valueHundredths: 500 }])).toBe(true)
  })

  it('dos puntos no son tendencia', () => {
    expect(hasSustainedDecline([{ valueHundredths: 900 }, { valueHundredths: 500 }])).toBe(false)
  })

  it('una recuperación corta la racha', () => {
    expect(hasSustainedDecline([{ valueHundredths: 900 }, { valueHundredths: 700 }, { valueHundredths: 800 }])).toBe(false)
  })

  it('los huecos no cuentan como baja', () => {
    expect(
      hasSustainedDecline([{ valueHundredths: 900 }, { valueHundredths: null }, { valueHundredths: 700 }]),
    ).toBe(false)
  })
})
