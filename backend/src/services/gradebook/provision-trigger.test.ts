import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, provisionGradeBooks } = vi.hoisted(() => ({
  prismaMock: { schoolYear: { findMany: vi.fn() } },
  provisionGradeBooks: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('./provision.js', () => ({ provisionGradeBooks }))

const {
  affectsGradeBooks,
  provisionTargetsForBatch,
  provisionTargetsForSave,
  scheduleGradeBookProvision,
} = await import('./provision-trigger.js')

function clase(over: Record<string, unknown> = {}) {
  return {
    type: 'CLASE',
    schoolYearId: 'sy-1',
    courseOfferingId: 'off-1',
    subjectId: 'sub-1',
    parentEventId: null,
    ...over,
  }
}

/** La provisión se dispara sin esperarla: hay que cederle el turno al event loop. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.schoolYear.findMany.mockResolvedValue([{ id: 'sy-1' }])
  provisionGradeBooks.mockResolvedValue({ created: 1, updated: 0 })
})

describe('affectsGradeBooks', () => {
  it('reconoce una clase con grupo y asignatura', () => {
    expect(affectsGradeBooks(clase())).toBe(true)
  })

  it('una clase cancelada igual cambia la libreta: el titular vigente pasa a ser otro', () => {
    expect(affectsGradeBooks(clase({ status: 'CANCELLED' }))).toBe(true)
  })

  it('ignora lo que no es clase', () => {
    expect(affectsGradeBooks(clase({ type: 'REUNION' }))).toBe(false)
    expect(affectsGradeBooks(clase({ type: 'JORNADA_LABORAL' }))).toBe(false)
  })

  it('ignora una clase sin asignatura o sin grupo: no identifica ninguna libreta', () => {
    expect(affectsGradeBooks(clase({ subjectId: null }))).toBe(false)
    expect(affectsGradeBooks(clase({ courseOfferingId: null }))).toBe(false)
    expect(affectsGradeBooks(clase({ schoolYearId: null }))).toBe(false)
  })

  it('ignora las excepciones de una ocurrencia, que no aportan scope propio', () => {
    expect(affectsGradeBooks(clase({ parentEventId: 'padre-1' }))).toBe(false)
  })

  it('tolera null', () => {
    expect(affectsGradeBooks(null)).toBe(false)
    expect(affectsGradeBooks(undefined)).toBe(false)
  })
})

describe('provisionTargetsForSave', () => {
  it('un alta apunta al ciclo del evento', () => {
    expect(provisionTargetsForSave(null, clase())).toEqual(['sy-1'])
  })

  it('un cambio de ciclo reprovisiona los dos, sin repetir', () => {
    expect(provisionTargetsForSave(clase(), clase({ schoolYearId: 'sy-2' }))).toEqual(['sy-1', 'sy-2'])
    expect(provisionTargetsForSave(clase(), clase())).toEqual(['sy-1'])
  })

  it('una baja apunta al ciclo que quedó atrás', () => {
    expect(provisionTargetsForSave(clase(), null)).toEqual(['sy-1'])
  })

  it('si no hay libreta en juego de ningún lado, no hay nada que hacer', () => {
    expect(provisionTargetsForSave(clase({ type: 'REUNION' }), clase({ type: 'REUNION' }))).toEqual([])
  })
})

describe('provisionTargetsForBatch', () => {
  it('una importación dispara una vez por ciclo, no una por fila', () => {
    expect(
      provisionTargetsForBatch([clase(), clase(), clase({ schoolYearId: 'sy-2' }), clase({ subjectId: null })]),
    ).toEqual(['sy-1', 'sy-2'])
  })
})

describe('scheduleGradeBookProvision', () => {
  it('provisiona los ciclos pedidos', async () => {
    scheduleGradeBookProvision(['sy-1'])
    await flush()
    expect(provisionGradeBooks).toHaveBeenCalledWith('sy-1', prismaMock)
  })

  it('no toca la base si no hay ciclos', async () => {
    scheduleGradeBookProvision([])
    await flush()
    expect(prismaMock.schoolYear.findMany).not.toHaveBeenCalled()
    expect(provisionGradeBooks).not.toHaveBeenCalled()
  })

  it('saltea los ciclos cerrados: no revive libretas de un año archivado', async () => {
    prismaMock.schoolYear.findMany.mockResolvedValue([])
    scheduleGradeBookProvision(['sy-viejo'])
    await flush()
    const [[query]] = prismaMock.schoolYear.findMany.mock.calls
    expect(query.where).toEqual({ id: { in: ['sy-viejo'] }, status: { not: 'CLOSED' } })
    expect(provisionGradeBooks).not.toHaveBeenCalled()
  })

  it('un fallo de la provisión no se propaga: guardar el evento no puede depender de esto', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    provisionGradeBooks.mockRejectedValue(new Error('moodle caído'))

    expect(() => scheduleGradeBookProvision(['sy-1'])).not.toThrow()
    await flush()

    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
