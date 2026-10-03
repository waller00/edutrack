import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  archiveSchoolYearGradeBooks,
  countOpenPeriods,
  historicalSummary,
  unarchiveSchoolYearGradeBooks,
} from './archive.js'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    gradeBook: { count: vi.fn(), updateMany: vi.fn() },
    gradeBookPeriod: { count: vi.fn() },
    endorsement: { count: vi.fn() },
    periodGrade: { count: vi.fn() },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.gradeBook.count.mockResolvedValue(0)
  prismaMock.gradeBookPeriod.count.mockResolvedValue(0)
  prismaMock.gradeBook.updateMany.mockResolvedValue({ count: 0 })
})

describe('archiveSchoolYearGradeBooks', () => {
  it('archiva sólo las activas del ciclo', async () => {
    prismaMock.gradeBook.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2)
    prismaMock.gradeBook.updateMany.mockResolvedValue({ count: 8 })

    const summary = await archiveSchoolYearGradeBooks('sy-1', prismaMock as any)

    expect(summary).toMatchObject({ archived: 8, alreadyArchived: 2 })
    expect(prismaMock.gradeBook.updateMany.mock.calls[0][0]).toEqual({
      where: { schoolYearId: 'sy-1', status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    })
  })

  it('informa los períodos abiertos pero NO bloquea el cierre', async () => {
    // Un año lectivo termina en una fecha, no cuando el último docente completó su libreta.
    prismaMock.gradeBookPeriod.count.mockResolvedValue(5)
    prismaMock.gradeBook.updateMany.mockResolvedValue({ count: 3 })

    const summary = await archiveSchoolYearGradeBooks('sy-1', prismaMock as any)

    expect(summary.openPeriods).toBe(5)
    expect(summary.archived).toBe(3)
  })

  it('reejecutar no vuelve a archivar lo ya archivado', async () => {
    prismaMock.gradeBook.count.mockResolvedValueOnce(4).mockResolvedValueOnce(4)
    prismaMock.gradeBook.updateMany.mockResolvedValue({ count: 0 })

    const summary = await archiveSchoolYearGradeBooks('sy-1', prismaMock as any)
    expect(summary).toMatchObject({ archived: 0, alreadyArchived: 4 })
  })

  it('un ciclo sin libretas no rompe', async () => {
    const summary = await archiveSchoolYearGradeBooks('sy-1', prismaMock as any)
    expect(summary).toMatchObject({ archived: 0, alreadyArchived: 0, openPeriods: 0 })
  })
})

describe('countOpenPeriods', () => {
  it('cuenta lo que no está cerrado, incluidos los reabiertos', async () => {
    prismaMock.gradeBookPeriod.count.mockResolvedValue(3)
    expect(await countOpenPeriods('sy-1', prismaMock as any)).toBe(3)
    expect(prismaMock.gradeBookPeriod.count.mock.calls[0][0].where.status).toEqual({ not: 'CLOSED' })
  })
})

describe('unarchiveSchoolYearGradeBooks', () => {
  it('devuelve las libretas a activo', async () => {
    prismaMock.gradeBook.updateMany.mockResolvedValue({ count: 7 })
    const result = await unarchiveSchoolYearGradeBooks('sy-1', prismaMock as any)

    expect(result.restored).toBe(7)
    expect(prismaMock.gradeBook.updateMany.mock.calls[0][0]).toEqual({
      where: { schoolYearId: 'sy-1', status: 'ARCHIVED' },
      data: { status: 'ACTIVE' },
    })
  })

  it('reabrir el ciclo NO reabre los períodos', async () => {
    // Cada período conserva su estado y su historial de visado.
    prismaMock.gradeBook.updateMany.mockResolvedValue({ count: 7 })
    await unarchiveSchoolYearGradeBooks('sy-1', prismaMock as any)
    expect(prismaMock.gradeBookPeriod.count).not.toHaveBeenCalled()
  })
})

describe('historicalSummary', () => {
  it('resume la actividad del ciclo', async () => {
    prismaMock.gradeBook.count.mockResolvedValue(12)
    prismaMock.gradeBookPeriod.count.mockResolvedValue(30)
    prismaMock.endorsement.count.mockResolvedValue(25)
    prismaMock.periodGrade.count.mockResolvedValue(400)

    expect(await historicalSummary('sy-1', prismaMock as any)).toEqual({
      gradeBooks: 12,
      closedPeriods: 30,
      endorsedPeriods: 25,
      periodGrades: 400,
    })
  })

  it('cuenta sólo los visados del período completo, no los de sección', async () => {
    prismaMock.endorsement.count.mockResolvedValue(5)
    await historicalSummary('sy-1', prismaMock as any)
    expect(prismaMock.endorsement.count.mock.calls[0][0].where).toMatchObject({
      section: 'ALL',
      status: 'ENDORSED',
    })
  })
})
