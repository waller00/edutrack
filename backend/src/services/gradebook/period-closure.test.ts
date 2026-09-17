import { describe, expect, it } from 'vitest'
import {
  closureBlockers,
  describeValue,
  isLateClosure,
  periodWriteBlock,
  type StudentPeriodRow,
} from './period-closure.js'

const LEVELS = [
  {
    id: 'l-bajo', label: 'Insuficiente', descriptor: 'No alcanza los aprendizajes.',
    minValueHundredths: 100, maxValueHundredths: 599,
    colorToken: 'red', iconToken: 'alert-triangle', isPassing: false, isAlert: true,
  },
  {
    id: 'l-alto', label: 'Logrado', descriptor: 'Alcanza los aprendizajes.',
    minValueHundredths: 600, maxValueHundredths: 1000,
    colorToken: 'green', iconToken: 'check', isPassing: true, isAlert: false,
  },
]

function student(over: Partial<StudentPeriodRow> = {}): StudentPeriodRow {
  return {
    studentId: 's1', lastName: 'B', firstName: 'Ana',
    assessmentValues: [], valueHundredths: 700, conceptualJudgement: 'Progresa bien.',
    ...over,
  }
}

describe('describeValue', () => {
  it('deriva descriptor y semáforo del tramo', () => {
    expect(describeValue(700, LEVELS)).toMatchObject({
      levelId: 'l-alto',
      label: 'Logrado',
      descriptor: 'Alcanza los aprendizajes.',
      iconToken: 'check',
      isPassing: true,
    })
  })

  it('devuelve null si no hay valor o ningún tramo lo cubre', () => {
    expect(describeValue(null, LEVELS)).toBeNull()
    expect(describeValue(50, LEVELS)).toBeNull()
  })
})

describe('closureBlockers', () => {
  const strict = { requiresGeneralGrade: true, requiresConceptualJudgement: true }

  it('sin faltantes no bloquea', () => {
    expect(closureBlockers([student()], strict)).toEqual([])
  })

  it('reporta a TODOS los que faltan, no sólo al primero', () => {
    const rows = [
      student({ studentId: 's1', valueHundredths: null }),
      student({ studentId: 's2' }),
      student({ studentId: 's3', valueHundredths: null }),
    ]
    expect(closureBlockers(rows, strict)).toEqual([
      { code: 'MISSING_GRADES', studentIds: ['s1', 's3'] },
    ])
  })

  it('acumula los dos bloqueos a la vez', () => {
    const rows = [student({ studentId: 's1', valueHundredths: null, conceptualJudgement: '' })]
    expect(closureBlockers(rows, strict).map((b) => b.code).sort()).toEqual([
      'MISSING_GRADES',
      'MISSING_JUDGEMENT',
    ])
  })

  it('un juicio en blanco no cuenta como juicio', () => {
    const rows = [student({ conceptualJudgement: '   ' })]
    expect(closureBlockers(rows, strict)).toEqual([{ code: 'MISSING_JUDGEMENT', studentIds: ['s1'] }])
  })

  it('si el período no exige juicio, no bloquea por eso', () => {
    const rows = [student({ conceptualJudgement: null })]
    expect(closureBlockers(rows, { requiresGeneralGrade: true, requiresConceptualJudgement: false })).toEqual([])
  })

  it('si el período no exige calificación general, tampoco', () => {
    const rows = [student({ valueHundredths: null })]
    expect(closureBlockers(rows, { requiresGeneralGrade: false, requiresConceptualJudgement: true })).toEqual([])
  })

  it('un grupo vacío no bloquea', () => {
    expect(closureBlockers([], strict)).toEqual([])
  })
})

describe('isLateClosure', () => {
  it('marca el cierre pasado el plazo', () => {
    expect(isLateClosure(new Date('2026-06-08T12:00:00Z'), new Date('2026-06-10T12:00:00Z'))).toBe(true)
    expect(isLateClosure(new Date('2026-06-08T12:00:00Z'), new Date('2026-06-01T12:00:00Z'))).toBe(false)
  })

  it('sin fecha límite nunca es tardío', () => {
    expect(isLateClosure(null, new Date())).toBe(false)
  })
})

describe('periodWriteBlock', () => {
  it('un período cerrado congela también las evaluaciones', () => {
    expect(periodWriteBlock({ periodStatus: 'CLOSED', gradeBookStatus: 'ACTIVE' })).toBe('CLOSED')
  })

  it('reabrirlo vuelve a habilitar la escritura', () => {
    expect(periodWriteBlock({ periodStatus: 'REOPENED', gradeBookStatus: 'ACTIVE' })).toBeNull()
  })

  it('un período que nunca se abrió no bloquea', () => {
    expect(periodWriteBlock({ periodStatus: null, gradeBookStatus: 'ACTIVE' })).toBeNull()
  })

  it('el ciclo archivado gana sobre cualquier estado del período', () => {
    expect(periodWriteBlock({ periodStatus: 'OPEN', gradeBookStatus: 'ARCHIVED' })).toBe('ARCHIVED')
  })
})
