import { describe, expect, it } from 'vitest'
import { apeFocusYear, apeOutcome, pendingResolvedAt, summarizeApe, type PendingRow } from './subjects-ape.js'

const row = (studentId: string, subjectId: string, over: Partial<PendingRow> = {}): PendingRow => ({
  studentId,
  subjectId,
  subjectName: subjectId === 'mat' ? 'Matemática' : 'Inglés',
  apeDecember: 'FAILED',
  apeFebruary: 'FAILED',
  resolvedAt: null,
  ...over,
})

describe('apeOutcome', () => {
  it('diciembre, febrero, como previa después, o la debe', () => {
    expect(apeOutcome({ apeDecember: 'PASSED', apeFebruary: null, resolvedAt: new Date() })).toBe('DECEMBER')
    expect(apeOutcome({ apeDecember: 'FAILED', apeFebruary: 'PASSED', resolvedAt: new Date() })).toBe('FEBRUARY')
    expect(apeOutcome({ apeDecember: 'NOT_TAKEN', apeFebruary: 'FAILED', resolvedAt: new Date() })).toBe('PREVIA')
    expect(apeOutcome({ apeDecember: 'FAILED', apeFebruary: 'NOT_TAKEN', resolvedAt: null })).toBe('OWED')
  })
})

describe('pendingResolvedAt', () => {
  const now = new Date('2026-11-04T15:00:00Z')
  const julio = new Date('2026-07-24T15:00:00Z')
  const previa = { apeDecember: 'FAILED', apeFebruary: 'FAILED', resolvedAt: julio }

  it('una materia nueva: salvada si aprobó una APE, abierta si no', () => {
    expect(pendingResolvedAt({ apeFebruary: 'PASSED' }, null, now)).toEqual(now)
    expect(pendingResolvedAt({ apeDecember: 'FAILED' }, null, now)).toBeNull()
  })

  it('editar la observación de una salvada como previa no le borra la fecha', () => {
    expect(pendingResolvedAt({ apeDecember: 'FAILED', apeFebruary: 'FAILED' }, previa, now)).toBeUndefined()
  })

  it('aprobar una APE conserva la fecha que ya tenía; deshacer el aprobado la reabre', () => {
    expect(pendingResolvedAt({ apeFebruary: 'PASSED' }, previa, now)).toEqual(julio)
    expect(pendingResolvedAt({ apeFebruary: 'FAILED' }, { apeDecember: 'FAILED', apeFebruary: 'PASSED', resolvedAt: julio }, now)).toBeNull()
  })

  it('passedAsPrevia la marca salvada o la reabre a propósito', () => {
    expect(pendingResolvedAt({ passedAsPrevia: true }, { ...previa, resolvedAt: null }, now)).toEqual(now)
    expect(pendingResolvedAt({ passedAsPrevia: true }, previa, now)).toEqual(julio)
    expect(pendingResolvedAt({ apeFebruary: 'PASSED', passedAsPrevia: false }, previa, now)).toBeNull()
  })
})

describe('summarizeApe', () => {
  const courseOf = new Map([
    ['ana', { courseId: 'c7', courseName: '7 EBI', position: 1 }],
    ['beto', { courseId: 'c7', courseName: '7 EBI', position: 1 }],
    ['carla', { courseId: 'c8', courseName: '8 EBI', position: 2 }],
  ])

  it('cuenta materias por curso y asignatura, y a cada estudiante una vez', () => {
    const summary = summarizeApe(
      [
        row('ana', 'mat', { apeDecember: 'PASSED' }),
        row('ana', 'ing', { apeFebruary: 'PASSED' }),
        row('beto', 'mat', { resolvedAt: new Date('2026-07-24') }),
        row('carla', 'mat'),
        // Sin curso conocido ese año: no se cuenta.
        row('zoe', 'mat'),
      ],
      courseOf,
    )
    expect(summary.students).toEqual({ referred: 3, clearedByFebruary: 1, clearedLater: 1, stillOwing: 1 })
    expect(summary.byCourse).toEqual([
      { courseId: 'c7', courseName: '7 EBI', position: 1, referred: 3, december: 1, february: 1, previa: 1, owed: 0, studentsReferred: 2 },
      { courseId: 'c8', courseName: '8 EBI', position: 2, referred: 1, december: 0, february: 0, previa: 0, owed: 1, studentsReferred: 1 },
    ])
    expect(summary.rows.map((r) => [r.courseName, r.subjectName, r.referred])).toEqual([
      ['7 EBI', 'Matemática', 2],
      ['7 EBI', 'Inglés', 1],
      ['8 EBI', 'Matemática', 1],
    ])
  })
})

describe('apeFocusYear', () => {
  const years = [
    { id: 'y24', code: 2024 },
    { id: 'y25', code: 2025 },
    { id: 'y26', code: 2026 },
  ]

  it('el pedido si ya tiene materias perdidas; si no, el último anterior que tenga', () => {
    const failed = new Map([
      ['y24', 30],
      ['y25', 31],
    ])
    expect(apeFocusYear(years, 'y25', failed)?.code).toBe(2025)
    expect(apeFocusYear(years, 'y26', failed)?.code).toBe(2025)
    expect(apeFocusYear(years, 'y24', new Map())).toBeNull()
  })
})
