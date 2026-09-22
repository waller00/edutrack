import { describe, expect, it } from 'vitest'
import {
  acceptsAssessments,
  canEditStudentClosurePeriod,
  closureBlockers,
  describeValue,
  isLateClosure,
  isOutOfScale,
  isPeriodCalendarOpen,
  officialPeriodValue,
  periodGradePatch,
  periodsCoveredBy,
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

describe('isPeriodCalendarOpen', () => {
  it('sin startsOn siempre está abierto', () => {
    expect(isPeriodCalendarOpen({ startsOn: null, todayYmd: '2026-03-01' })).toBe(true)
  })

  it('bloquea antes del día de inicio', () => {
    expect(
      isPeriodCalendarOpen({
        startsOn: new Date('2026-08-01T12:00:00.000Z'),
        todayYmd: '2026-07-31',
      }),
    ).toBe(false)
  })

  it('habilita el mismo día de inicio y después', () => {
    const startsOn = new Date('2026-08-01T12:00:00.000Z')
    expect(isPeriodCalendarOpen({ startsOn, todayYmd: '2026-08-01' })).toBe(true)
    expect(isPeriodCalendarOpen({ startsOn, todayYmd: '2026-09-01' })).toBe(true)
  })
})

describe('canEditStudentClosurePeriod', () => {
  it('no habilita períodos futuros aunque estén OPEN', () => {
    expect(
      canEditStudentClosurePeriod({
        canGrade: true,
        periodStatus: 'OPEN',
        gradeBookStatus: 'ACTIVE',
        startsOn: new Date('2026-10-01T12:00:00.000Z'),
        todayYmd: '2026-09-20',
      }),
    ).toBe(false)
  })

  it('habilita cuando el calendario ya empezó', () => {
    expect(
      canEditStudentClosurePeriod({
        canGrade: true,
        periodStatus: 'OPEN',
        gradeBookStatus: 'ACTIVE',
        startsOn: new Date('2026-03-01T12:00:00.000Z'),
        todayYmd: '2026-09-20',
      }),
    ).toBe(true)
  })
})

describe('reunión: C y R', () => {
  const rules = { requiresGeneralGrade: true, requiresConceptualJudgement: false, isMeeting: true }

  it('un período con reunión que exige C exige también R', () => {
    const rows = [
      student({ studentId: 's1', meetingValueHundredths: 700 }),
      student({ studentId: 's2', meetingValueHundredths: null }),
    ]
    expect(closureBlockers(rows, rules)).toEqual([{ code: 'MISSING_MEETING_GRADES', studentIds: ['s2'] }])
  })

  it('sin reunión, R no se exige', () => {
    expect(closureBlockers([student({ meetingValueHundredths: null })], { ...rules, isMeeting: false })).toEqual([])
  })

  it('con reunión pero sin exigir C (APE), no exige R', () => {
    expect(closureBlockers([student({ valueHundredths: null })], { ...rules, requiresGeneralGrade: false })).toEqual([])
  })

  it('la nota oficial es siempre R, nunca C', () => {
    expect(officialPeriodValue({ meetingValueHundredths: 800 })).toBe(800)
    expect(officialPeriodValue({ meetingValueHundredths: null })).toBeNull()
    expect(officialPeriodValue(null)).toBeNull()
  })
})

describe('periodGradePatch', () => {
  it('lo que no viene no se toca y null lo borra', () => {
    expect(periodGradePatch({ meetingValueHundredths: 700 })).toEqual({ meetingValueHundredths: 700 })
    expect(periodGradePatch({ valueHundredths: null, conceptualJudgement: undefined })).toEqual({ valueHundredths: null })
  })
})

describe('isOutOfScale', () => {
  const scale = { minValueHundredths: 100, maxValueHundredths: 1000 }
  it('controla el rango de la escala del nivel', () => {
    expect(isOutOfScale(1100, scale)).toBe(true)
    expect(isOutOfScale(50, scale)).toBe(true)
    expect(isOutOfScale(500, scale)).toBe(false)
    expect(isOutOfScale(null, scale)).toBe(false)
    expect(isOutOfScale(1100, null)).toBe(false)
  })
})

describe('periodsCoveredBy', () => {
  const periods = [
    { id: 'diag', kind: 'DIAGNOSTICO', sortOrder: 10 },
    { id: 'mar-abr', kind: 'TRAMO', sortOrder: 20 },
    { id: 'e1', kind: 'ENTREGA', sortOrder: 30 },
    { id: 'may-jun', kind: 'TRAMO', sortOrder: 40 },
    { id: 'jul', kind: 'TRAMO', sortOrder: 50 },
    { id: 'e2', kind: 'ENTREGA', sortOrder: 60 },
  ]

  it('una entrega cubre los tramos desde la entrega anterior', () => {
    expect(periodsCoveredBy(periods[2]!, periods)).toEqual(['mar-abr'])
    expect(periodsCoveredBy(periods[5]!, periods)).toEqual(['may-jun', 'jul'])
  })

  it('un tramo no cubre nada', () => {
    expect(periodsCoveredBy(periods[1]!, periods)).toEqual([])
  })

  it('sólo los tramos admiten evaluaciones', () => {
    expect(acceptsAssessments('TRAMO')).toBe(true)
    expect(acceptsAssessments('ENTREGA')).toBe(false)
    expect(acceptsAssessments('DIAGNOSTICO')).toBe(false)
  })
})
