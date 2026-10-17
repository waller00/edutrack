import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canWriteGradeBookGrades, resolveGradeBookAccess } from './access.js'

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

describe('AUD-03: escritura por día de suplencia', () => {
  const access = { level: 'SUBSTITUTE' as const, canRead: true, canGrade: true, canPlan: true }
  const params = { access, gradeScope: 'own' as const, userId: 'suplente-1', gradeBook: GB }

  beforeEach(() => {
    // Only this user, class and day are covered. The real date predicate must
    // discriminate historical access from write authorization.
    prismaMock.substitution.findFirst.mockImplementation(async ({ where }) => {
      return where.substituteUserId === 'suplente-1'
        && where.date?.toISOString() === '2026-05-10T03:00:00.000Z'
        && where.event.schoolYearId === GB.schoolYearId
        && where.event.courseOfferingId === GB.courseOfferingId
        && where.event.subjectId === GB.subjectId
        && where.event.orientationId === null
        && where.event.courseOrientationId === null ? { id: 's-1' } : null
    })
  })

  it.each(['2026-05-09', '2026-05-11', '2026-09-10'])('rechaza escritura del %s fuera del día cubierto', async (day) => {
    expect(await canWriteGradeBookGrades({ ...params, assessmentDate: new Date(`${day}T12:00:00Z`) }, prismaMock as any)).toBe(false)
  })

  it.each(['00:00:00', '12:00:00'])('autoriza el día civil cubierto, incluso con ancla UTC %s', async (time) => {
    expect(await canWriteGradeBookGrades({ ...params, assessmentDate: new Date(`2026-05-10T${time}Z`) }, prismaMock as any)).toBe(true)
  })

  it.each(['schoolYearId', 'courseOfferingId', 'subjectId', 'orientationId', 'courseOrientationId'])('no reutiliza cobertura con otro %s', async (field) => {
    expect(await canWriteGradeBookGrades({ ...params, gradeBook: { ...GB, [field]: 'other' }, assessmentDate: new Date('2026-05-10T12:00Z') }, prismaMock as any)).toBe(false)
  })

  it('no reutiliza la suplencia de otro docente', async () => {
    expect(await canWriteGradeBookGrades({ ...params, userId: 'other', assessmentDate: new Date('2026-05-10T12:00Z') }, prismaMock as any)).toBe(false)
  })

  it('no concede escrituras globales por una suplencia, pero respeta un grant all explícito', async () => {
    expect(await canWriteGradeBookGrades(params, prismaMock as any)).toBe(false)
    expect(await canWriteGradeBookGrades({ ...params, gradeScope: 'all' }, prismaMock as any)).toBe(true)
    expect(prismaMock.substitution.findFirst).not.toHaveBeenCalled()
  })

  it('no concede escritura en un ciclo archivado ni sin permiso', async () => {
    expect(await canWriteGradeBookGrades({ ...params, access: { ...access, canGrade: false }, gradeScope: 'all' }, prismaMock as any)).toBe(false)
    expect(await canWriteGradeBookGrades({ ...params, gradeScope: null }, prismaMock as any)).toBe(false)
  })
})
