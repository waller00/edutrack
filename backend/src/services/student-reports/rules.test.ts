import { describe, expect, it } from 'vitest'
import {
  findAbsenceStreaks,
  isGradeDrop,
  summarizeLowGrades,
  thresholdKey,
  thresholdsReached,
  type LowGradeBook,
} from './rules.js'

describe('18 y 25 faltas', () => {
  it('avisa a las 18 y vuelve a avisar a las 25', () => {
    expect(thresholdsReached(1750)).toEqual([])
    expect(thresholdsReached(1800)).toEqual([1800])
    expect(thresholdsReached(2450)).toEqual([1800])
    expect(thresholdsReached(2500)).toEqual([1800, 2500])
  })

  it('la clave es el número de faltas', () => {
    expect(thresholdKey(1800)).toBe('18')
    expect(thresholdKey(2500)).toBe('25')
  })
})

describe('findAbsenceStreaks', () => {
  // Lun 5 a vie 9 y lun 12 de octubre: el fin de semana no es día de clase, así que no aparece.
  const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12']

  it('tres días de clase seguidos con falta entera', () => {
    const absent = new Set(['2026-10-06', '2026-10-07', '2026-10-08'])
    expect(findAbsenceStreaks(days, absent)).toEqual([{ from: '2026-10-06', to: '2026-10-08', days: 3, open: false }])
  })

  it('el fin de semana y los feriados no cortan la racha', () => {
    const absent = new Set(['2026-10-08', '2026-10-09', '2026-10-12'])
    expect(findAbsenceStreaks(days, absent)).toEqual([{ from: '2026-10-08', to: '2026-10-12', days: 3, open: true }])
  })

  it('un día de clase sin falta entera la corta', () => {
    const absent = new Set(['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09'])
    expect(findAbsenceStreaks(days, absent)).toEqual([])
  })

  it('dos faltas seguidas no alcanzan', () => {
    expect(findAbsenceStreaks(days, new Set(['2026-10-05', '2026-10-06']))).toEqual([])
  })

  it('una racha larga es una sola alerta', () => {
    const streaks = findAbsenceStreaks(days, new Set(days))
    expect(streaks).toHaveLength(1)
    expect(streaks[0]).toMatchObject({ from: '2026-10-05', days: 6, open: true })
  })
})

describe('summarizeLowGrades', () => {
  const isLow = (v: number) => v < 500
  const book = (over: Partial<LowGradeBook>): LowGradeBook => ({
    courseOfferingId: 'off-1',
    courseName: '7 EBI',
    orientationName: null,
    subjectName: 'Matemática',
    rosterSize: 4,
    officialValues: [],
    ...over,
  })

  it('% de alumnos con nota baja sobre los que tienen R, y cuántos faltan', () => {
    const { rows } = summarizeLowGrades(
      [
        book({
          officialValues: [
            { studentId: 'a', valueHundredths: 300 },
            { studentId: 'b', valueHundredths: 700 },
            { studentId: 'c', valueHundredths: 800 },
          ],
        }),
      ],
      isLow,
    )
    expect(rows[0]).toMatchObject({ graded: 3, low: 1, percent: 33.3, pending: 1 })
  })

  it('sin R todavía no inventa un 0 %', () => {
    const { rows } = summarizeLowGrades([book({})], isLow)
    expect(rows[0]).toMatchObject({ graded: 0, percent: null, pending: 4 })
  })

  it('el total del curso cuenta alumnos distintos, no materias', () => {
    const { courses } = summarizeLowGrades(
      [
        book({ officialValues: [{ studentId: 'a', valueHundredths: 300 }, { studentId: 'b', valueHundredths: 800 }] }),
        book({ subjectName: 'Historia', officialValues: [{ studentId: 'a', valueHundredths: 200 }, { studentId: 'b', valueHundredths: 900 }] }),
      ],
      isLow,
    )
    expect(courses).toEqual([{ courseOfferingId: 'off-1', courseName: '7 EBI', graded: 2, low: 1, percent: 50 }])
  })
})

describe('isGradeDrop', () => {
  it('bajó si la R es menor que la del boletín anterior', () => {
    expect(isGradeDrop({ previous: 800, current: 600 })).toBe(true)
    expect(isGradeDrop({ previous: 800, current: 800 })).toBe(false)
    expect(isGradeDrop({ previous: 600, current: 800 })).toBe(false)
  })

  it('sin alguna de las dos R no hay comparación', () => {
    expect(isGradeDrop({ previous: null, current: 600 })).toBe(false)
    expect(isGradeDrop({ previous: 800, current: null })).toBe(false)
  })
})
