import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    moodleObjectMap: { findMany: vi.fn() },
    assessment: { findMany: vi.fn() },
  },
}))

import {
  buildImportPlan,
  mapMoodleUsersToStudents,
  rescaleToTarget,
  studentIdFromIdnumber,
} from './moodle-import.js'

const ITEM = {
  id: 10,
  name: 'Parcial 1',
  itemType: 'mod',
  itemModule: 'assign',
  gradeMin: 0,
  gradeMax: 100,
  hidden: false,
}

const TARGET = { minHundredths: 100, maxHundredths: 1200 }

beforeEach(() => vi.clearAllMocks())

describe('rescaleToTarget', () => {
  it('proyecta linealmente de 0-100 a 1-12', () => {
    // Copiar el crudo daría "80" en una escala que llega a 12.
    expect(rescaleToTarget(0, { min: 0, max: 100 }, TARGET)).toBe(100)
    expect(rescaleToTarget(100, { min: 0, max: 100 }, TARGET)).toBe(1200)
    expect(rescaleToTarget(50, { min: 0, max: 100 }, TARGET)).toBe(650)
  })

  it('acota fuera de rango en vez de extrapolar', () => {
    expect(rescaleToTarget(150, { min: 0, max: 100 }, TARGET)).toBe(1200)
    expect(rescaleToTarget(-10, { min: 0, max: 100 }, TARGET)).toBe(100)
  })

  it('un ítem con rango degenerado cae al mínimo, sin dividir por cero', () => {
    expect(rescaleToTarget(5, { min: 5, max: 5 }, TARGET)).toBe(100)
  })

  it('cuando las escalas coinciden el valor se conserva', () => {
    expect(rescaleToTarget(8, { min: 1, max: 12 }, TARGET)).toBe(800)
  })
})

describe('studentIdFromIdnumber', () => {
  it('extrae el uuid del idnumber de EduTrack', () => {
    expect(studentIdFromIdnumber('et-student-abc-123')).toBe('abc-123')
  })

  it('ignora idnumbers ajenos o vacíos', () => {
    expect(studentIdFromIdnumber('otro-sistema-9')).toBeNull()
    expect(studentIdFromIdnumber(null)).toBeNull()
  })
})

describe('mapMoodleUsersToStudents', () => {
  it('usa el idnumber sin consultar la base', async () => {
    const map = await mapMoodleUsersToStudents(
      [{ moodleUserId: 101, idnumber: 'et-student-s1' }],
      prismaMock as any,
    )
    expect(map.get(101)).toBe('s1')
    expect(prismaMock.moodleObjectMap.findMany).not.toHaveBeenCalled()
  })

  it('cae al mapeo persistente cuando el idnumber se perdió', async () => {
    prismaMock.moodleObjectMap.findMany.mockResolvedValue([{ moodleId: 102, localId: 's2' }])

    const map = await mapMoodleUsersToStudents(
      [{ moodleUserId: 101, idnumber: 'et-student-s1' }, { moodleUserId: 102, idnumber: null }],
      prismaMock as any,
    )

    expect(map.get(102)).toBe('s2')
    // Sólo se consulta por los que faltaban.
    expect(prismaMock.moodleObjectMap.findMany.mock.calls[0][0].where.moodleId).toEqual({ in: [102] })
  })

  it('un usuario sin idnumber ni mapeo queda afuera', async () => {
    prismaMock.moodleObjectMap.findMany.mockResolvedValue([])
    const map = await mapMoodleUsersToStudents([{ moodleUserId: 999, idnumber: null }], prismaMock as any)
    expect(map.has(999)).toBe(false)
  })
})

describe('buildImportPlan', () => {
  const base = {
    item: ITEM,
    studentByMoodleUser: new Map([[101, 's1'], [102, 's2'], [103, 'ajeno']]),
    rosterStudentIds: new Set(['s1', 's2']),
    target: TARGET,
  }

  it('convierte a la escala destino sólo a los del grupo', () => {
    const plan = buildImportPlan({
      ...base,
      grades: [
        { moodleUserId: 101, itemId: 10, raw: 100 },
        { moodleUserId: 102, itemId: 10, raw: 0 },
      ],
    })
    expect(plan.entries).toEqual([
      { studentId: 's1', valueHundredths: 1200 },
      { studentId: 's2', valueHundredths: 100 },
    ])
  })

  it('un alumno sin calificar en Moodle NO se importa como cero', () => {
    // Es la diferencia entre "no rindió todavía" y "sacó lo mínimo".
    const plan = buildImportPlan({ ...base, grades: [{ moodleUserId: 101, itemId: 10, raw: null }] })
    expect(plan.entries).toEqual([])
    expect(plan.skippedUnmatched).toBe(0)
  })

  it('cuenta como no mapeado a quien no pertenece a la cohorte', () => {
    const plan = buildImportPlan({ ...base, grades: [{ moodleUserId: 103, itemId: 10, raw: 90 }] })
    expect(plan.entries).toEqual([])
    expect(plan.skippedUnmatched).toBe(1)
  })

  it('ignora las notas de otros ítems', () => {
    const plan = buildImportPlan({ ...base, grades: [{ moodleUserId: 101, itemId: 99, raw: 90 }] })
    expect(plan.entries).toEqual([])
  })
})
