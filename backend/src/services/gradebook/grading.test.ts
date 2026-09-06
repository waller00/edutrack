import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertStudentsInRoster,
  assertValueWithinScale,
  GradingError,
  hasChanges,
  saveGrades,
} from './grading.js'

const NUMERIC = {
  id: 'sc-1',
  kind: 'NUMERIC' as const,
  minValueHundredths: 100,
  maxValueHundredths: 1000,
  levels: [
    { id: 'l-bajo', minValueHundredths: 100, maxValueHundredths: 599 },
    { id: 'l-alto', minValueHundredths: 600, maxValueHundredths: 1000 },
  ],
}

const ORDINAL = {
  id: 'sc-2',
  kind: 'ORDINAL' as const,
  minValueHundredths: 100,
  maxValueHundredths: 300,
  levels: [
    { id: 'rojo', minValueHundredths: 100, maxValueHundredths: 100 },
    { id: 'amarillo', minValueHundredths: 200, maxValueHundredths: 200 },
    { id: 'verde', minValueHundredths: 300, maxValueHundredths: 300 },
  ],
}

const ROSTER = [
  { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Benítez', documentId: '1-2' },
  { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'Cardozo', documentId: null },
]

function code(fn: () => void): string {
  try {
    fn()
    return 'NO_LANZO'
  } catch (error) {
    return (error as GradingError).code
  }
}

describe('assertValueWithinScale', () => {
  it('acepta un valor dentro del rango', () => {
    expect(() => assertValueWithinScale(750, NUMERIC)).not.toThrow()
  })

  it('rechaza por debajo y por encima del rango', () => {
    expect(code(() => assertValueWithinScale(50, NUMERIC))).toBe('VALUE_OUT_OF_SCALE')
    expect(code(() => assertValueWithinScale(1100, NUMERIC))).toBe('VALUE_OUT_OF_SCALE')
  })

  it('en una escala ordinal sólo admite los valores de sus niveles', () => {
    expect(() => assertValueWithinScale(200, ORDINAL)).not.toThrow()
    expect(code(() => assertValueWithinScale(250, ORDINAL))).toBe('VALUE_NOT_A_LEVEL')
  })
})

describe('assertStudentsInRoster', () => {
  it('acepta a los del grupo', () => {
    expect(() => assertStudentsInRoster([{ studentId: 's1' }], ROSTER)).not.toThrow()
  })

  it('rechaza a un ajeno y dice cuál', () => {
    try {
      assertStudentsInRoster([{ studentId: 's1' }, { studentId: 'intruso' }], ROSTER)
      throw new Error('debió lanzar')
    } catch (error) {
      expect((error as GradingError).code).toBe('STUDENT_NOT_IN_ROSTER')
      expect((error as GradingError).details).toEqual({ studentIds: ['intruso'] })
    }
  })
})

describe('hasChanges', () => {
  const existing = { id: 'g1', valueHundredths: 700, scaleLevelId: 'l-alto', isAbsent: false }

  it('sin cambios devuelve false', () => {
    expect(hasChanges(existing, { valueHundredths: 700, scaleLevelId: 'l-alto', isAbsent: false })).toBe(false)
  })

  it('detecta cambio de valor, de ausencia y borrado', () => {
    expect(hasChanges(existing, { valueHundredths: 800, scaleLevelId: 'l-alto', isAbsent: false })).toBe(true)
    expect(hasChanges(existing, { valueHundredths: 700, scaleLevelId: 'l-alto', isAbsent: true })).toBe(true)
    expect(hasChanges(existing, { valueHundredths: null, scaleLevelId: null, isAbsent: false })).toBe(true)
  })
})

describe('saveGrades', () => {
  const { txMock, prismaMock } = vi.hoisted(() => {
    const txMock = {
      assessmentGrade: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
      gradeRevision: { create: vi.fn() },
    }
    return {
      txMock,
      prismaMock: { $transaction: vi.fn(async (fn: any) => fn(txMock)) },
    }
  })

  const base = {
    assessmentId: 'a-1',
    roster: ROSTER,
    scale: NUMERIC,
    actorUserId: 'teacher-1',
    origin: 'TEACHER' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(txMock))
    txMock.assessmentGrade.findMany.mockResolvedValue([])
  })

  it('la primera carga crea sin dejar revisión: no hay nada que reescribir', async () => {
    const res = await saveGrades({ ...base, entries: [{ studentId: 's1', valueHundredths: 700 }] }, prismaMock as any)

    expect(res).toMatchObject({ created: 1, updated: 0, revisions: 0 })
    expect(txMock.gradeRevision.create).not.toHaveBeenCalled()
  })

  it('guarda el snapshot de identidad del estudiante', async () => {
    await saveGrades({ ...base, entries: [{ studentId: 's1', valueHundredths: 700 }] }, prismaMock as any)

    expect(txMock.assessmentGrade.create.mock.calls[0][0].data).toMatchObject({
      studentLastName: 'Benítez',
      studentFirstName: 'Ana',
      studentDocumentId: '1-2',
      studentEnrollmentId: 'e1',
    })
  })

  it('deriva el tramo del valor en una escala numérica, sin confiar en el cliente', async () => {
    await saveGrades({ ...base, entries: [{ studentId: 's1', valueHundredths: 700 }] }, prismaMock as any)
    expect(txMock.assessmentGrade.create.mock.calls[0][0].data.scaleLevelId).toBe('l-alto')
  })

  it('modificar una nota deja la revisión con el valor anterior y el nuevo', async () => {
    txMock.assessmentGrade.findMany.mockResolvedValue([
      { id: 'g1', studentId: 's1', valueHundredths: 500, scaleLevelId: 'l-bajo', isAbsent: false },
    ])

    const res = await saveGrades(
      { ...base, entries: [{ studentId: 's1', valueHundredths: 900 }], reason: 'error de carga' },
      prismaMock as any,
    )

    expect(res).toMatchObject({ created: 0, updated: 1, revisions: 1 })
    expect(txMock.gradeRevision.create.mock.calls[0][0].data).toMatchObject({
      assessmentGradeId: 'g1',
      previousValueHundredths: 500,
      newValueHundredths: 900,
      previousScaleLevelId: 'l-bajo',
      newScaleLevelId: 'l-alto',
      reason: 'error de carga',
      origin: 'TEACHER',
      changedByUserId: 'teacher-1',
    })
  })

  it('reenviar el mismo valor no escribe ni audita', async () => {
    txMock.assessmentGrade.findMany.mockResolvedValue([
      { id: 'g1', studentId: 's1', valueHundredths: 700, scaleLevelId: 'l-alto', isAbsent: false },
    ])

    const res = await saveGrades({ ...base, entries: [{ studentId: 's1', valueHundredths: 700 }] }, prismaMock as any)

    expect(res).toMatchObject({ unchanged: 1, updated: 0, revisions: 0 })
    expect(txMock.assessmentGrade.update).not.toHaveBeenCalled()
  })

  it('borrar una nota también deja revisión', async () => {
    txMock.assessmentGrade.findMany.mockResolvedValue([
      { id: 'g1', studentId: 's1', valueHundredths: 700, scaleLevelId: 'l-alto', isAbsent: false },
    ])

    await saveGrades({ ...base, entries: [{ studentId: 's1', valueHundredths: null }] }, prismaMock as any)

    expect(txMock.gradeRevision.create.mock.calls[0][0].data).toMatchObject({
      previousValueHundredths: 700,
      newValueHundredths: null,
    })
  })

  it('rechaza el lote entero si hay un estudiante ajeno, sin escribir nada', async () => {
    await expect(
      saveGrades({ ...base, entries: [{ studentId: 's1', valueHundredths: 700 }, { studentId: 'x' }] }, prismaMock as any),
    ).rejects.toMatchObject({ code: 'STUDENT_NOT_IN_ROSTER' })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rechaza ausente con calificación: son estados excluyentes', async () => {
    await expect(
      saveGrades({ ...base, entries: [{ studentId: 's1', valueHundredths: 700, isAbsent: true }] }, prismaMock as any),
    ).rejects.toMatchObject({ code: 'ABSENT_WITH_VALUE' })
  })

  it('todo el lote va en una transacción', async () => {
    await saveGrades(
      { ...base, entries: [{ studentId: 's1', valueHundredths: 700 }, { studentId: 's2', valueHundredths: 800 }] },
      prismaMock as any,
    )
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(txMock.assessmentGrade.create).toHaveBeenCalledTimes(2)
  })

  it('marca el origen ADMIN_CORRECTION cuando escribe administración', async () => {
    txMock.assessmentGrade.findMany.mockResolvedValue([
      { id: 'g1', studentId: 's1', valueHundredths: 500, scaleLevelId: 'l-bajo', isAbsent: false },
    ])
    await saveGrades(
      { ...base, entries: [{ studentId: 's1', valueHundredths: 900 }], origin: 'ADMIN_CORRECTION', reason: 'reclamo' },
      prismaMock as any,
    )
    expect(txMock.gradeRevision.create.mock.calls[0][0].data.origin).toBe('ADMIN_CORRECTION')
  })
})
