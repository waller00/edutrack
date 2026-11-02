import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, moodleMocks } = vi.hoisted(() => ({
  prismaMock: {
    moodleObjectMap: { findMany: vi.fn() },
    assessment: { findMany: vi.fn() },
    gradeRevision: { findMany: vi.fn() },
  },
  moodleMocks: {
    enabled: vi.fn(),
    mappedId: vi.fn(),
    scope: vi.fn(),
    report: vi.fn(),
  },
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../../integrations/moodle/client.js', () => ({ isMoodleIntegrationEnabled: moodleMocks.enabled }))
vi.mock('../../integrations/moodle/object-map.js', () => ({ getMappedId: moodleMocks.mappedId }))
vi.mock('../../integrations/moodle/scope.js', () => ({ resolveMoodleAcademicScope: moodleMocks.scope }))
vi.mock('../../integrations/moodle/gradebook.js', () => ({ fetchCourseGradeReport: moodleMocks.report }))

import {
  buildImportPlan,
  buildImportPreview,
  isEditedInEduTrack,
  loadImportedAssessments,
  mapMoodleUsersToStudents,
  rescaleToTarget,
  studentIdFromIdnumber,
  type ExistingImportedGrade,
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
      { studentId: 's1', valueHundredths: 1200, importedValueHundredths: 1200 },
      { studentId: 's2', valueHundredths: 100, importedValueHundredths: 100 },
    ])
    expect(plan.rows.map((row) => row.status)).toEqual(['NEW', 'NEW'])
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

  it('un ítem sin rango no se importa: antes ponía la nota mínima a todo el grupo', () => {
    const plan = buildImportPlan({
      ...base,
      item: { ...ITEM, gradeMin: 0, gradeMax: 0 },
      grades: [
        { moodleUserId: 101, itemId: 10, raw: 0 },
        { moodleUserId: 102, itemId: 10, raw: 0 },
      ],
    })
    expect(plan.entries).toEqual([])
    expect(plan.skippedNoRange).toBe(2)
  })
})

const IMPORTED_AT = new Date('2026-10-01T12:00:00Z')
const DAYS_LATER = new Date('2026-10-08T12:00:00Z')

/** Una nota que trajo Moodle (un 8) y nadie tocó. */
function moodleGrade(overrides: Partial<ExistingImportedGrade> = {}): ExistingImportedGrade {
  return {
    valueHundredths: 800,
    isAbsent: false,
    comment: null,
    importedValueHundredths: 800,
    createdAt: IMPORTED_AT,
    hasNonMoodleRevision: false,
    ...overrides,
  }
}

describe('isEditedInEduTrack', () => {
  it('la nota que sigue siendo la de Moodle no está corregida', () => {
    expect(isEditedInEduTrack(moodleGrade(), IMPORTED_AT)).toBe(false)
  })

  it('si el valor ya no es el que trajo Moodle, la corrigió alguien en la libreta', () => {
    expect(isEditedInEduTrack(moodleGrade({ valueHundredths: 900 }), IMPORTED_AT)).toBe(true)
  })

  it('marcarla ausente también es corregirla', () => {
    expect(isEditedInEduTrack(moodleGrade({ valueHundredths: null, isAbsent: true }), IMPORTED_AT)).toBe(true)
  })

  describe('notas importadas antes de que se guardara el valor de Moodle', () => {
    const legacy = (overrides: Partial<ExistingImportedGrade> = {}) =>
      moodleGrade({ importedValueHundredths: null, ...overrides })

    it('creada con la evaluación y sin cambios desde la libreta: es de Moodle', () => {
      expect(isEditedInEduTrack(legacy(), IMPORTED_AT)).toBe(false)
    })

    it('con una revisión del docente: está corregida', () => {
      expect(isEditedInEduTrack(legacy({ hasNonMoodleRevision: true }), IMPORTED_AT)).toBe(true)
    })

    it('creada días después de la evaluación: la puso el docente a mano', () => {
      expect(isEditedInEduTrack(legacy({ createdAt: DAYS_LATER }), IMPORTED_AT)).toBe(true)
    })
  })
})

describe('buildImportPlan en una reimportación', () => {
  const base = {
    item: ITEM,
    studentByMoodleUser: new Map([[101, 's1']]),
    rosterStudentIds: new Set(['s1']),
    target: TARGET,
    // 100/100 en Moodle: un 12.
    grades: [{ moodleUserId: 101, itemId: 10, raw: 100 }],
  }
  const reimport = (grade: ExistingImportedGrade) =>
    buildImportPlan({
      ...base,
      current: { createdAt: IMPORTED_AT, grades: new Map([['s1', grade]]), deletedStudentIds: new Set() },
    })

  it('no vuelve a poner la nota que alguien borró en la libreta', () => {
    const plan = buildImportPlan({
      ...base,
      current: { createdAt: IMPORTED_AT, grades: new Map(), deletedStudentIds: new Set(['s1']) },
    })

    expect(plan.rows[0]).toMatchObject({ status: 'EDITED_IN_EDUTRACK', currentValueHundredths: null })
    expect(plan.entries).toEqual([])
    expect(plan.skippedEditedInEduTrack).toBe(1)
  })

  it('actualiza la nota de Moodle que cambió allá y conserva el comentario del docente', () => {
    const plan = reimport(moodleGrade({ comment: 'Entregó tarde' }))

    expect(plan.rows[0]).toMatchObject({ status: 'UPDATE', valueHundredths: 1200, currentValueHundredths: 800 })
    expect(plan.entries).toEqual([
      { studentId: 's1', valueHundredths: 1200, importedValueHundredths: 1200, comment: 'Entregó tarde', isAbsent: false },
    ])
  })

  it('no toca la nota corregida en la libreta: la cuenta aparte', () => {
    const plan = reimport(moodleGrade({ valueHundredths: 900 }))

    expect(plan.rows[0].status).toBe('EDITED_IN_EDUTRACK')
    expect(plan.entries).toEqual([])
    expect(plan.skippedEditedInEduTrack).toBe(1)
  })

  it('si no cambió nada, no escribe', () => {
    const plan = reimport(moodleGrade({ valueHundredths: 1200, importedValueHundredths: 1200 }))

    expect(plan.rows[0].status).toBe('UNCHANGED')
    expect(plan.entries).toEqual([])
  })

  it('una nota vieja igual a la de Moodle se escribe sólo para guardarle el valor importado', () => {
    const plan = reimport(moodleGrade({ valueHundredths: 1200, importedValueHundredths: null }))

    expect(plan.rows[0].status).toBe('UNCHANGED')
    expect(plan.entries).toEqual([
      { studentId: 's1', valueHundredths: 1200, importedValueHundredths: 1200, comment: null, isAbsent: false },
    ])
  })
})

describe('loadImportedAssessments', () => {
  it('junta las notas de cada ítem y las que alguien borró en la libreta', async () => {
    prismaMock.assessment.findMany.mockResolvedValue([
      {
        id: 'as-1',
        moodleGradeItemId: 10,
        createdAt: IMPORTED_AT,
        grades: [{ studentId: 's1', ...moodleGrade(), revisions: [] }],
      },
    ])
    prismaMock.gradeRevision.findMany.mockResolvedValue([{ assessmentId: 'as-1', studentId: 's2' }])

    const byItem = await loadImportedAssessments('gb-1', [10], prismaMock as any)
    const current = byItem.get(10)!

    expect(current.grades.get('s1')).toMatchObject({ valueHundredths: 800, hasNonMoodleRevision: false })
    expect([...current.deletedStudentIds]).toEqual(['s2'])
    // Las borradas son las revisiones que quedaron sin nota, y no las de la importación.
    expect(prismaMock.gradeRevision.findMany.mock.calls[0][0].where).toEqual({
      assessmentId: { in: ['as-1'] },
      assessmentGradeId: null,
      origin: { not: 'MOODLE_IMPORT' },
    })
  })

  it('sin evaluaciones importadas no busca borradas', async () => {
    prismaMock.assessment.findMany.mockResolvedValue([])

    const byItem = await loadImportedAssessments('gb-1', [10], prismaMock as any)

    expect(byItem.size).toBe(0)
    expect(prismaMock.gradeRevision.findMany).not.toHaveBeenCalled()
  })
})

describe('buildImportPreview', () => {
  const gradeBook = {
    id: 'gb-1',
    schoolYearId: 'sy-1',
    courseOfferingId: 'co-1',
    subjectId: 'sub-1',
    orientationId: null,
    courseOrientationId: null,
  }
  const students = [
    { studentId: 's1', firstName: 'Ana', lastName: 'Suárez' },
    { studentId: 's2', firstName: 'Bruno', lastName: 'Acosta' },
  ]

  beforeEach(() => {
    moodleMocks.enabled.mockReturnValue(true)
    moodleMocks.mappedId.mockResolvedValue(7)
    moodleMocks.scope.mockReturnValue({ idnumber: 'et-subject-x' })
    moodleMocks.report.mockResolvedValue({
      items: [ITEM],
      grades: [
        { moodleUserId: 101, idnumber: 'et-student-s1', itemId: 10, raw: 100 },
        { moodleUserId: 102, idnumber: 'et-student-s2', itemId: 10, raw: 50 },
      ],
    })
  })

  it('con escala muestra cada nota convertida, lo que tiene hoy y qué le va a pasar', async () => {
    prismaMock.assessment.findMany
      // La evaluación que ya generó el ítem, con sus notas: s1 la corrigió el docente.
      .mockResolvedValueOnce([
        {
          id: 'as-1',
          moodleGradeItemId: 10,
          createdAt: IMPORTED_AT,
          grades: [{ studentId: 's1', ...moodleGrade({ valueHundredths: 900 }), revisions: [{ id: 'r' }] }],
        },
      ])
      // Evaluaciones existentes (para "ya importado").
      .mockResolvedValueOnce([{ id: 'as-1', moodleGradeItemId: 10 }])
    prismaMock.gradeRevision.findMany.mockResolvedValue([])

    const preview = await buildImportPreview(gradeBook, students, TARGET, prismaMock as any)
    const [item] = preview.items

    // Ordenado por apellido.
    expect(item.rows).toEqual([
      { studentId: 's2', studentName: 'Acosta, Bruno', moodleRaw: 50, valueHundredths: 650, currentValueHundredths: null, status: 'NEW' },
      { studentId: 's1', studentName: 'Suárez, Ana', moodleRaw: 100, valueHundredths: 1200, currentValueHundredths: 900, status: 'EDITED_IN_EDUTRACK' },
    ])
    expect(item.summary).toEqual({ new: 1, update: 0, unchanged: 0, editedInEduTrack: 1 })
  })

  it('sin escala sólo trae los conteos', async () => {
    prismaMock.assessment.findMany.mockResolvedValueOnce([])

    const preview = await buildImportPreview(gradeBook, students, null, prismaMock as any)

    expect(preview.items[0]).toMatchObject({ matched: 2, unmatched: 0 })
    expect(preview.items[0].rows).toBeUndefined()
    expect(prismaMock.assessment.findMany).toHaveBeenCalledTimes(1)
  })
})
