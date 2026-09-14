import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveGradeBookAccess } from './access.js'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { substitution: { findFirst: vi.fn() } },
}))

const GB = {
  teacherUserId: 'titular-1',
  schoolYearId: 'sy-1',
  courseOfferingId: 'off-1',
  subjectId: 'sub-1',
  orientationId: null,
  courseOrientationId: null,
  status: 'ACTIVE' as const,
}

function call(over: Partial<Parameters<typeof resolveGradeBookAccess>[0]> = {}) {
  return resolveGradeBookAccess(
    { userId: 'u-1', readScope: 'own', gradeScope: 'own', planScope: 'own', gradeBook: GB, ...over },
    prismaMock as any,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.substitution.findFirst.mockResolvedValue(null)
})

describe('titular', () => {
  it('lee y califica su libreta', async () => {
    expect(await call({ userId: 'titular-1' })).toEqual({
      level: 'OWNER',
      canRead: true,
      canGrade: true,
      canPlan: true,
    })
  })

  it('no consulta suplencias si ya es titular', async () => {
    await call({ userId: 'titular-1' })
    expect(prismaMock.substitution.findFirst).not.toHaveBeenCalled()
  })
})

describe('suplente', () => {
  it('accede si cubrió alguna clase de la libreta', async () => {
    prismaMock.substitution.findFirst.mockResolvedValue({ id: 's-1' })
    expect(await call({ userId: 'suplente-1' })).toEqual({
      level: 'SUBSTITUTE',
      canRead: true,
      canGrade: true,
      canPlan: true,
    })
  })

  it('busca la suplencia por el scope de la libreta, no por un evento suelto', async () => {
    prismaMock.substitution.findFirst.mockResolvedValue({ id: 's-1' })
    await call({ userId: 'suplente-1' })
    expect(prismaMock.substitution.findFirst.mock.calls[0][0].where).toMatchObject({
      substituteUserId: 'suplente-1',
      event: { schoolYearId: 'sy-1', courseOfferingId: 'off-1', subjectId: 'sub-1' },
    })
  })
})

describe('docente ajeno', () => {
  it('no accede a una libreta que no es suya ni suplió', async () => {
    expect(await call({ userId: 'ajeno-1' })).toEqual({
      level: 'NONE',
      canRead: false,
      canGrade: false,
      canPlan: false,
    })
  })
})

describe('supervisión (alcance all)', () => {
  it('adscripción y dirección leen todo pero NO califican', async () => {
    // Tienen gradebook.read con alcance all y no tienen gradebook.grade.
    expect(
      await call({ userId: 'adscripto-1', readScope: 'all', gradeScope: null, planScope: null }),
    ).toEqual({ level: 'SUPERVISION', canRead: true, canGrade: false, canPlan: false })
  })

  it('administración con grade all sí puede escribir', async () => {
    expect(
      await call({ userId: 'admin-1', readScope: 'all', gradeScope: 'all', planScope: 'all' }),
    ).toEqual({ level: 'SUPERVISION', canRead: true, canGrade: true, canPlan: true })
  })

  it('dirección planifica una libreta ajena pero no la califica', async () => {
    // Es la regla del liceo: el director corrige la libreta salvo calificaciones y juicios.
    expect(
      await call({ userId: 'director-1', readScope: 'all', gradeScope: null, planScope: 'all' }),
    ).toEqual({ level: 'SUPERVISION', canRead: true, canGrade: false, canPlan: true })
  })

  it('un alcance amplio no se busca suplencias: no hace falta', async () => {
    await call({ userId: 'adscripto-1', readScope: 'all', gradeScope: null, planScope: null })
    expect(prismaMock.substitution.findFirst).not.toHaveBeenCalled()
  })
})

describe('sin permiso', () => {
  it('sin gradebook.read no lee, aunque sea el titular', async () => {
    const access = await call({ userId: 'titular-1', readScope: null, gradeScope: null, planScope: null })
    expect(access.canRead).toBe(false)
    expect(access.canGrade).toBe(false)
  })
})

describe('ciclo archivado', () => {
  it('nadie escribe una libreta archivada, ni siquiera administración', async () => {
    const archived = { ...GB, status: 'ARCHIVED' as const }
    for (const who of [
      { userId: 'titular-1', readScope: 'own' as const, gradeScope: 'own' as const, planScope: 'own' as const },
      { userId: 'admin-1', readScope: 'all' as const, gradeScope: 'all' as const, planScope: 'all' as const },
    ]) {
      const access = await resolveGradeBookAccess({ ...who, gradeBook: archived }, prismaMock as any)
      expect(access.canGrade, `${who.userId} no debe escribir un ciclo cerrado`).toBe(false)
      expect(access.canRead).toBe(true)
    }
  })
})
