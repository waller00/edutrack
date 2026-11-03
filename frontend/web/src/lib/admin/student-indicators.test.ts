import { describe, expect, it } from 'vitest'
import {
  attendanceByCourse,
  attendancePriorities,
  matchesStudent,
  percentage,
  type AbsenceStreak,
  type AbsenceThreshold,
} from './student-indicators'

const student = { studentId: 's1', firstName: 'Ana', lastName: 'Pérez', courseName: '7 EBI' }
const streak = (patch: Partial<AbsenceStreak> = {}): AbsenceStreak => ({
  ...student,
  from: '2026-04-01',
  to: '2026-04-07',
  days: 4,
  open: true,
  ...patch,
})
const threshold = (patch: Partial<AbsenceThreshold> = {}): AbsenceThreshold => ({
  ...student,
  absenceHundredths: 1850,
  threshold: 1800,
  ...patch,
})

describe('indicadores de estudiantes', () => {
  it('combina alertas sin repetir al estudiante y prioriza a quien tiene ambas señales', () => {
    const rows = attendancePriorities(
      [streak(), streak({ days: 6 }), streak({ studentId: 'historico', open: false })],
      [threshold(), threshold({ studentId: 's2', absenceHundredths: 3000, threshold: 2500 })],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ studentId: 's1', absenceHundredths: 1850, streakDays: 6 })
    expect(rows[0].reasons).toHaveLength(2)
  })

  it('clasifica 24,5 y 25 faltas en bandas distintas y cuenta rachas por estudiante', () => {
    const rows = attendanceByCourse(
      [streak(), streak(), streak({ studentId: 's3', open: false })],
      [
        threshold({ absenceHundredths: 2450 }),
        threshold({ studentId: 's2', absenceHundredths: 2500, threshold: 2500 }),
      ],
    )
    expect(rows).toEqual([{ course: '7 EBI', active: 1, warning: 1, critical: 1 }])
  })

  it('no inventa el total de faltas de un estudiante que sólo tiene alerta de racha', () => {
    expect(attendancePriorities([streak()], [])[0]).toMatchObject({
      absenceHundredths: null,
      streakDays: 4,
    })
    expect(attendancePriorities([streak({ open: false })], [])).toEqual([])
  })

  it('busca palabras en nombre y curso sin depender de tildes ni mayúsculas', () => {
    expect(matchesStudent(student, 'PEREZ ana 7')).toBe(true)
    expect(matchesStudent(student, 'ana 8')).toBe(false)
    expect(matchesStudent(student, '')).toBe(true)
  })

  it('distingue una cohorte vacía de un porcentaje real de cero', () => {
    expect(percentage(0, 0)).toBeNull()
    expect(percentage(0, 10)).toBe(0)
    expect(percentage(1, 3)).toBe(33.3)
  })
})
