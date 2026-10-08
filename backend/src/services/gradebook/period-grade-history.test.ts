import { describe, expect, it, vi } from 'vitest'
import { periodGradeRevision, writePeriodGrades } from './period-grade-history.js'

const STORED = { valueHundredths: 800, meetingValueHundredths: 900, conductValueHundredths: null, conceptualJudgement: 'Avanza.' }

describe('periodGradeRevision', () => {
  it('cambiar la R deja lo anterior y lo nuevo', () => {
    expect(periodGradeRevision(STORED, { meetingValueHundredths: 700 })).toEqual({
      judgementChanged: false,
      previousMeetingValueHundredths: 900,
      newMeetingValueHundredths: 700,
    })
  })

  it('borrar una nota también es una corrección', () => {
    expect(periodGradeRevision(STORED, { valueHundredths: null })).toMatchObject({
      previousValueHundredths: 800,
      newValueHundredths: null,
    })
  })

  it('cargar por primera vez no es corregir', () => {
    expect(periodGradeRevision(STORED, { conductValueHundredths: 300 })).toBeNull()
    expect(periodGradeRevision(null, { valueHundredths: 800 })).toBeNull()
  })

  it('reenviar lo mismo no deja revisión', () => {
    expect(periodGradeRevision(STORED, { valueHundredths: 800, conceptualJudgement: ' Avanza. ' })).toBeNull()
  })

  it('el informe guarda los dos textos', () => {
    expect(periodGradeRevision(STORED, { conceptualJudgement: 'Avanza con autonomía.' })).toEqual({
      judgementChanged: true,
      previousJudgement: 'Avanza.',
      newJudgement: 'Avanza con autonomía.',
    })
  })
})

describe('writePeriodGrades', () => {
  const student = { studentId: 's1', lastName: 'Benítez', firstName: 'Ana', documentId: null }

  function tx(existing: unknown[]) {
    return {
      periodGrade: { findMany: vi.fn().mockResolvedValue(existing), upsert: vi.fn().mockResolvedValue({}) },
      periodGradeRevision: { create: vi.fn().mockResolvedValue({}) },
    }
  }

  it('guarda parcial y registra la corrección con su origen', async () => {
    const db = tx([{ studentId: 's1', ...STORED }])
    const revisions = await writePeriodGrades(db as never, {
      gradeBookPeriodId: 'gbp-1',
      rows: [{ student, entry: { meetingValueHundredths: 1000 } }],
      actorUserId: 'u-1',
      origin: 'TEACHER',
    })

    expect(revisions).toBe(1)
    expect(db.periodGrade.upsert.mock.calls[0][0].update).toEqual({ meetingValueHundredths: 1000, updatedByUserId: 'u-1' })
    expect(db.periodGradeRevision.create.mock.calls[0][0].data).toMatchObject({
      gradeBookPeriodId: 'gbp-1',
      studentId: 's1',
      origin: 'TEACHER',
      previousMeetingValueHundredths: 900,
      newMeetingValueHundredths: 1000,
    })
  })

  it('la primera carga crea la fila con el snapshot y sin revisión', async () => {
    const db = tx([])
    await writePeriodGrades(db as never, {
      gradeBookPeriodId: 'gbp-1',
      rows: [{ student, entry: { valueHundredths: 700 } }],
      actorUserId: 'u-1',
      origin: 'TEACHER',
    })
    expect(db.periodGrade.upsert.mock.calls[0][0].create).toMatchObject({ studentLastName: 'Benítez', valueHundredths: 700 })
    expect(db.periodGradeRevision.create).not.toHaveBeenCalled()
  })
})
