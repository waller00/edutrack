import { describe, expect, it } from 'vitest'
import {
  apeParts,
  cohortLabel,
  cohortParts,
  focusNote,
  outcomeParts,
  trajectoryHeadline,
  type TrajectoryCounts,
  type TrajectoryCourse,
} from './student-trajectory'

const counts = (over: Partial<TrajectoryCounts> = {}): TrajectoryCounts => ({
  enrolled: 0,
  leftWithdrawn: 0,
  leftTransferred: 0,
  inProgress: 0,
  promoted: 0,
  promotedWithPending: 0,
  repeated: 0,
  graduated: 0,
  graduatedWithPending: 0,
  pendingApe: 0,
  noResult: 0,
  notReenrolled: 0,
  continuationPending: 0,
  ...over,
})

const course = (courseName: string, position: number, over: Partial<TrajectoryCounts>, level: string | null = 'EBI'): TrajectoryCourse => ({
  courseId: courseName,
  courseName,
  level,
  position,
  ...counts(over),
})

describe('trayectoria', () => {
  it('el egreso se cuenta sobre el último grado de cada nivel', () => {
    const byCourse = [
      course('7 EBI', 1, { enrolled: 30 }),
      course('9 EBI', 3, { enrolled: 28 }),
      course('1 EMS', 1, { enrolled: 20 }, 'EMS'),
    ]
    const total = counts({ enrolled: 78, promoted: 40, promotedWithPending: 5, repeated: 4, graduated: 25, graduatedWithPending: 1, leftWithdrawn: 1, leftTransferred: 2, notReenrolled: 3 })
    expect(trajectoryHeadline(total, byCourse)).toEqual({
      enrolled: 78,
      promoted: 45,
      promotedWithPending: 5,
      repeated: 4,
      graduated: 26,
      finalEnrolled: 48,
      left: 6,
      leftDuringYear: 3,
      notReenrolled: 3,
    })
  })

  it('las partes de cómo terminó el año suman los matriculados', () => {
    const parts = outcomeParts(counts({ enrolled: 10, promoted: 4, promotedWithPending: 1, repeated: 1, graduated: 2, leftTransferred: 1, noResult: 1 }))
    expect(parts.map((p) => [p.key, p.value])).toEqual([
      ['promoted', 5],
      ['repeated', 1],
      ['graduated', 2],
      ['left', 1],
      ['other', 1],
    ])
    expect(parts.reduce((acc, p) => acc + p.value, 0)).toBe(10)
  })

  it('cada generación con su nivel y lo que fue de ella', () => {
    const cohort = { level: 'EBI', entryYear: 2023, entrants: 10, graduatedOnTime: 6, graduatedLate: 1, onTrack: 0, behind: 1, left: 2, unknown: 0 }
    expect(cohortLabel(cohort)).toBe('Ingreso 2023 (ciclo básico)')
    expect(cohortLabel({ entryYear: 2024, level: null })).toBe('Ingreso 2024')
    expect(cohortParts(cohort).reduce((acc, p) => acc + p.value, 0)).toBe(10)
  })
})

describe('materias y APE', () => {
  it('lo que todavía se debe queda marcado', () => {
    const parts = apeParts({ referred: 5, december: 2, february: 1, previa: 1, owed: 1 })
    expect(parts.map((p) => p.value)).toEqual([2, 1, 1, 1])
    expect(parts.find((p) => p.key === 'owed')?.alert).toBe(true)
    expect(apeParts({ referred: 1, december: 1, february: 0, previa: 0, owed: 0 }).some((p) => p.alert)).toBe(false)
  })

  it('aclara cuando el año que se muestra no es el elegido', () => {
    const y25 = { id: 'y25', code: 2025, label: 'Ciclo 2025', status: 'CLOSED' }
    const y26 = { id: 'y26', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE' }
    expect(focusNote(y26, y25, 'todavía no terminó')).toBe('Ciclo 2026 todavía no terminó: se muestra Ciclo 2025.')
    expect(focusNote(y25, y25, 'todavía no terminó')).toBeNull()
    expect(focusNote(y26, null, 'todavía no terminó')).toBeNull()
    expect(focusNote(null, y25, 'todavía no terminó')).toBeNull()
  })
})
