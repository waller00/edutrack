import { describe, expect, it } from 'vitest'
import {
  buildTrajectory,
  departureOf,
  focusYear,
  outcomeOf,
  rankCourses,
  yearResult,
  type TrajectoryEnrollment,
  type TrajectoryYear,
} from './trajectory.js'

const Y23: TrajectoryYear = { id: 'y23', code: 2023, label: 'Ciclo 2023', status: 'CLOSED', endsOn: new Date('2023-12-15T12:00:00Z') }
const Y24: TrajectoryYear = { id: 'y24', code: 2024, label: 'Ciclo 2024', status: 'CLOSED', endsOn: new Date('2024-12-15T12:00:00Z') }
const Y25: TrajectoryYear = { id: 'y25', code: 2025, label: 'Ciclo 2025', status: 'ACTIVE', endsOn: new Date('2025-12-15T12:00:00Z') }

const COURSES = [
  { id: 'c9', code: '9-EBI', name: '9 EBI', level: 'EBI', sortOrder: 3 },
  { id: 'c7', code: '7-EBI', name: '7 EBI', level: 'EBI', sortOrder: 1 },
  { id: 'c8', code: '8-EBI', name: '8 EBI', level: 'EBI', sortOrder: 2 },
  { id: 'b1', code: '1-EMS', name: '1 EMS', level: 'EMS', sortOrder: 1 },
]
const ranks = rankCourses(COURSES)

function enr(studentId: string, schoolYearId: string, courseId: string, over: Partial<TrajectoryEnrollment> = {}): TrajectoryEnrollment {
  return { studentId, schoolYearId, courseId, enrollmentStatus: 'ACTIVE', academicResult: null, withdrawnAt: null, withdrawalAcademicYear: null, ...over }
}

describe('rankCourses', () => {
  it('ordena cada nivel por su orden y marca el último grado', () => {
    expect(ranks.get('c7')).toEqual({ level: 'EBI', position: 1, isFinal: false, levelLength: 3 })
    expect(ranks.get('c9')).toEqual({ level: 'EBI', position: 3, isFinal: true, levelLength: 3 })
    expect(ranks.get('b1')).toMatchObject({ level: 'EMS', position: 1, isFinal: true })
  })
})

describe('departureOf', () => {
  it('una baja con el año de la baja es durante el año; con el año siguiente, al empezarlo', () => {
    expect(departureOf(enr('a', 'y23', 'c7', { enrollmentStatus: 'WITHDRAWN', withdrawalAcademicYear: 2023 }), Y23)).toBe('DURING_YEAR')
    expect(departureOf(enr('a', 'y23', 'c7', { enrollmentStatus: 'TRANSFERRED', withdrawalAcademicYear: 2024 }), Y23)).toBe('AT_YEAR_START')
  })

  it('sin año, decide la fecha: después del fin del ciclo es al empezar el siguiente', () => {
    expect(departureOf(enr('a', 'y23', 'c7', { enrollmentStatus: 'WITHDRAWN', withdrawnAt: new Date('2024-02-20T12:00:00Z') }), Y23)).toBe('AT_YEAR_START')
    expect(departureOf(enr('a', 'y23', 'c7', { enrollmentStatus: 'WITHDRAWN', withdrawnAt: new Date('2023-06-01T12:00:00Z') }), Y23)).toBe('DURING_YEAR')
    expect(departureOf(enr('a', 'y23', 'c7'), Y23)).toBeNull()
  })
})

describe('yearResult', () => {
  it('el fallo cargado manda', () => {
    expect(yearResult(enr('a', 'y23', 'c8', { academicResult: 'REPEATED' }), enr('a', 'y24', 'c9'), ranks, false)).toBe('REPEATED')
  })

  it('sin fallo, sale de la matrícula del año siguiente', () => {
    expect(yearResult(enr('a', 'y23', 'c8'), enr('a', 'y24', 'c8'), ranks, false)).toBe('REPEATED')
    expect(yearResult(enr('a', 'y23', 'c8'), enr('a', 'y24', 'c9'), ranks, false)).toBe('PROMOTED')
    expect(yearResult(enr('a', 'y23', 'c8'), enr('a', 'y24', 'c9'), ranks, true)).toBe('PROMOTED_WITH_PENDING')
    // Pasar de 9.º a bachillerato es promover.
    expect(yearResult(enr('a', 'y23', 'c9'), enr('a', 'y24', 'b1'), ranks, false)).toBe('PROMOTED')
  })

  it('egresado sin fallo cargado es una promoción; sin nada, no hay fallo', () => {
    expect(yearResult(enr('a', 'y23', 'c9', { enrollmentStatus: 'GRADUATED' }), null, ranks, false)).toBe('PROMOTED')
    expect(yearResult(enr('a', 'y23', 'c9', { academicResult: 'PENDING_APE' }), null, ranks, false)).toBe('PENDING_APE')
    expect(yearResult(enr('a', 'y23', 'c9'), null, ranks, false)).toBeNull()
  })
})

describe('outcomeOf', () => {
  const ctx = { year: Y23, next: null, nextYearStarted: true, ranks, owesAfterApe: false }

  it('promover en el último grado sin matrícula siguiente es egresar (el caso del seed)', () => {
    expect(outcomeOf(enr('a', 'y23', 'c9', { academicResult: 'PROMOTED' }), ctx)).toEqual({ end: 'GRADUATED', continuation: null })
    expect(outcomeOf(enr('a', 'y23', 'c9', { academicResult: 'PROMOTED_WITH_PENDING' }), ctx)).toEqual({ end: 'GRADUATED_WITH_PENDING', continuation: null })
  })

  it('en el último grado sin fallo ni matrícula siguiente no se sabe: no cuenta como desvinculación', () => {
    expect(outcomeOf(enr('a', 'y23', 'c9'), ctx)).toEqual({ end: 'NO_RESULT', continuation: null })
  })

  it('quien terminó el año y no aparece en el siguiente no se reinscribió; si el siguiente no empezó, no se sabe', () => {
    expect(outcomeOf(enr('a', 'y23', 'c8', { academicResult: 'PROMOTED' }), ctx)).toEqual({ end: 'PROMOTED', continuation: 'NOT_REENROLLED' })
    expect(outcomeOf(enr('a', 'y23', 'c8', { academicResult: 'PROMOTED' }), { ...ctx, nextYearStarted: false })).toEqual({ end: 'PROMOTED', continuation: 'PENDING' })
    expect(outcomeOf(enr('a', 'y23', 'c8', { academicResult: 'PROMOTED' }), { ...ctx, next: enr('a', 'y24', 'c9') })).toEqual({ end: 'PROMOTED', continuation: 'CONTINUED' })
  })

  it('una baja durante el año es una baja; en el ciclo en curso, se está cursando', () => {
    expect(outcomeOf(enr('a', 'y23', 'c8', { enrollmentStatus: 'TRANSFERRED', withdrawalAcademicYear: 2023 }), ctx).end).toBe('LEFT_TRANSFERRED')
    expect(outcomeOf(enr('a', 'y25', 'c8'), { ...ctx, year: Y25 }).end).toBe('IN_PROGRESS')
  })
})

describe('focusYear', () => {
  it('el pedido si está cerrado; si no, el último cerrado', () => {
    expect(focusYear([Y23, Y24, Y25], 'y24')?.code).toBe(2024)
    expect(focusYear([Y23, Y24, Y25], 'y25')?.code).toBe(2024)
    expect(focusYear([Y25], 'y25')).toBeNull()
  })
})

describe('buildTrajectory', () => {
  // a: generación 2023 en tiempo. d: repitió 7.º. e: no se reinscribió. f: se fue en el año.
  // b: entró por pase a 8.º (no es generación). c: egresó de 9.º en 2023.
  const enrollments = [
    enr('a', 'y23', 'c7', { academicResult: 'PROMOTED' }),
    enr('a', 'y24', 'c8'),
    enr('a', 'y25', 'c9'),
    enr('b', 'y23', 'c8', { academicResult: 'REPEATED' }),
    enr('b', 'y24', 'c8'),
    enr('b', 'y25', 'c9'),
    enr('c', 'y23', 'c9', { academicResult: 'PROMOTED' }),
    enr('d', 'y23', 'c7'),
    enr('d', 'y24', 'c7'),
    enr('d', 'y25', 'c8'),
    enr('e', 'y23', 'c7', { academicResult: 'PROMOTED' }),
    enr('f', 'y23', 'c7', { enrollmentStatus: 'WITHDRAWN', withdrawalAcademicYear: 2023 }),
  ]
  const result = buildTrajectory({ years: [Y25, Y23, Y24], courses: COURSES, enrollments, failed: [] }, 'y23')

  it('cuenta cómo terminó cada año', () => {
    const y2023 = result.byYear.find((y) => y.code === 2023)!
    expect(y2023).toMatchObject({ enrolled: 6, promoted: 2, repeated: 2, graduated: 1, leftWithdrawn: 1, notReenrolled: 1 })
    expect(result.byYear.find((y) => y.code === 2025)).toMatchObject({ enrolled: 3, inProgress: 3 })
  })

  it('el año que se mira es el pedido si cerró, con su detalle por curso', () => {
    expect(result.focusYear?.code).toBe(2023)
    expect(result.byCourse.map((c) => [c.courseName, c.enrolled])).toEqual([
      ['7 EBI', 4],
      ['8 EBI', 1],
      ['9 EBI', 1],
    ])
    expect(result.total.enrolled).toBe(6)
  })

  it('sigue a cada generación: en tiempo, atrasados y los que se fueron', () => {
    const [cohort2023] = result.cohorts
    expect(cohort2023).toMatchObject({ level: 'EBI', entryYear: 2023, entrants: 4, onTrack: 1, behind: 1, left: 2, graduatedOnTime: 0 })
    expect(cohort2023.timeline.map((p) => [p.code, p.onTrack, p.behind, p.left])).toEqual([
      [2023, 3, 0, 1],
      [2024, 1, 1, 2],
      [2025, 1, 1, 2],
    ])
  })
})
