import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventFamilyId, groupEventsByScope, provisionGradeBooks } from './provision.js'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    event: { findMany: vi.fn() },
    courseOffering: { findMany: vi.fn() },
    gradeBook: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))

const SY = 'sy-1'
const OFFERING = 'off-1'
const SUBJECT = 'sub-1'

function ev(over: Partial<any> = {}) {
  return {
    id: 'e1',
    revisionOf: null,
    assignedUserId: 'teacher-1',
    userId: 'admin-1',
    schoolYearId: SY,
    courseOfferingId: OFFERING,
    subjectId: SUBJECT,
    orientationId: null,
    courseOrientationId: null,
    startDate: new Date('2026-03-02T12:00:00.000Z'),
    ...over,
  }
}

describe('eventFamilyId', () => {
  it('agrupa las versiones de una serie por su raíz', () => {
    expect(eventFamilyId({ id: 'v2', revisionOf: 'v1' })).toBe('v1')
    expect(eventFamilyId({ id: 'v1', revisionOf: null })).toBe('v1')
  })
})

describe('groupEventsByScope', () => {
  it('una asignatura sin orientación es una sola libreta, aunque tenga varias clases', () => {
    const { groups } = groupEventsByScope([ev({ id: 'e1' }), ev({ id: 'e2' }), ev({ id: 'e3' })])
    expect(groups.size).toBe(1)
    expect([...groups.values()][0].scopeKey).toBe(`et-subject-offering-${OFFERING}-${SUBJECT}`)
  })

  it('la misma asignatura en dos orientaciones son dos libretas', () => {
    const { groups } = groupEventsByScope([
      ev({ id: 'e1', courseOrientationId: 'co-a' }),
      ev({ id: 'e2', courseOrientationId: 'co-b' }),
    ])
    expect(groups.size).toBe(2)
  })

  it('courseOrientationId gana sobre orientationId, igual que en Moodle y el pase de lista', () => {
    const { groups } = groupEventsByScope([ev({ courseOrientationId: 'co-a', orientationId: 'o-a' })])
    const group = [...groups.values()][0]
    expect(group.courseOrientationId).toBe('co-a')
    expect(group.orientationId).toBeNull()
  })

  it('el titular sale del evento más reciente: un cambio de profesor a mitad de año se refleja', () => {
    const { groups } = groupEventsByScope([
      ev({ id: 'e1', assignedUserId: 'viejo', startDate: new Date('2026-03-02T12:00:00.000Z') }),
      ev({ id: 'e2', assignedUserId: 'nuevo', startDate: new Date('2026-08-02T12:00:00.000Z') }),
    ])
    expect([...groups.values()][0].teacherUserId).toBe('nuevo')
  })

  it('una versión posterior de la MISMA serie no cambia el titular', () => {
    // Editar una serie crea una versión nueva con fecha mayor; sin agrupar por familia, esa
    // versión ganaría la comparación y pisaría al titular real de otra serie.
    const { groups } = groupEventsByScope([
      ev({ id: 'e1', revisionOf: null, assignedUserId: 'titular', startDate: new Date('2026-08-02T12:00:00.000Z') }),
      ev({ id: 'e2', revisionOf: 'e1', assignedUserId: 'otro', startDate: new Date('2026-09-02T12:00:00.000Z') }),
    ])
    expect([...groups.values()][0].teacherUserId).toBe('titular')
  })

  it('cuenta como omitido el evento sin asignatura, sin inventar libreta', () => {
    const { groups, skipped } = groupEventsByScope([ev({ subjectId: null }), ev({ courseOfferingId: null })])
    expect(groups.size).toBe(0)
    expect(skipped).toBe(2)
  })

  it('un evento sin docente asignado igual crea la libreta, sin titular', () => {
    const { groups } = groupEventsByScope([ev({ assignedUserId: null })])
    expect([...groups.values()][0].teacherUserId).toBeNull()
  })
})

describe('provisionGradeBooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.courseOffering.findMany.mockResolvedValue([{ id: OFFERING }])
    prismaMock.gradeBook.findUnique.mockResolvedValue(null)
    prismaMock.gradeBook.create.mockResolvedValue({ id: 'gb-1' })
    prismaMock.gradeBook.update.mockResolvedValue({ id: 'gb-1' })
  })

  it('crea la libreta con la clave de scope como identidad', async () => {
    prismaMock.event.findMany.mockResolvedValue([ev()])
    const summary = await provisionGradeBooks(SY, prismaMock as any)

    expect(summary).toMatchObject({ created: 1, updated: 0, skippedNotOffered: 0 })
    expect(prismaMock.gradeBook.create.mock.calls[0][0].data).toMatchObject({
      scopeKey: `et-subject-offering-${OFFERING}-${SUBJECT}`,
      courseOfferingId: OFFERING,
      subjectId: SUBJECT,
      teacherUserId: 'teacher-1',
    })
  })

  it('es idempotente: si ya existe actualiza el titular y no duplica', async () => {
    prismaMock.event.findMany.mockResolvedValue([ev()])
    prismaMock.gradeBook.findUnique.mockResolvedValue({ id: 'gb-1' })

    const summary = await provisionGradeBooks(SY, prismaMock as any)

    expect(summary).toMatchObject({ created: 0, updated: 1 })
    expect(prismaMock.gradeBook.create).not.toHaveBeenCalled()
    expect(prismaMock.gradeBook.update.mock.calls[0][0].data).toEqual({ teacherUserId: 'teacher-1' })
  })

  it('al actualizar no toca el status: no revive una libreta archivada', async () => {
    prismaMock.event.findMany.mockResolvedValue([ev()])
    prismaMock.gradeBook.findUnique.mockResolvedValue({ id: 'gb-1' })
    await provisionGradeBooks(SY, prismaMock as any)
    expect(prismaMock.gradeBook.update.mock.calls[0][0].data).not.toHaveProperty('status')
  })

  it('no genera libretas para un curso que dejó de ofertarse ese ciclo', async () => {
    // Caso real: 2.º EMS está en el catálogo pero no se oferta en 2026.
    prismaMock.event.findMany.mockResolvedValue([ev({ courseOfferingId: 'off-no-ofertada' })])
    prismaMock.courseOffering.findMany.mockResolvedValue([{ id: OFFERING }])

    const summary = await provisionGradeBooks(SY, prismaMock as any)

    expect(summary).toMatchObject({ created: 0, skippedNotOffered: 1 })
    expect(prismaMock.gradeBook.create).not.toHaveBeenCalled()
  })

  it('sólo mira eventos de clase no cancelados del ciclo', async () => {
    prismaMock.event.findMany.mockResolvedValue([])
    await provisionGradeBooks(SY, prismaMock as any)

    expect(prismaMock.event.findMany.mock.calls[0][0].where).toMatchObject({
      schoolYearId: SY,
      type: 'CLASE',
      status: { not: 'CANCELLED' },
      parentEventId: null,
    })
  })
})
