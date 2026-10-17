import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSubstituteAccessOpen, resolveGradeBookAccess, substituteAccessUntil } from './access.js'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { substitution: { aggregate: vi.fn() } },
}))

const NOW = new Date('2026-06-15T15:00:00.000Z')
const NO_SPAN = { _min: { date: null }, _max: { date: null } }
/** Suplencias de quien pide en la libreta, como días civiles (medianoche de Uruguay). */
function substituted(first: string, last = first) {
  prismaMock.substitution.aggregate.mockResolvedValue({
    _min: { date: new Date(`${first}T03:00:00.000Z`) },
    _max: { date: new Date(`${last}T03:00:00.000Z`) },
  })
}

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
    { userId: 'u-1', readScope: 'own', gradeScope: 'own', planScope: 'own', gradeBook: GB, now: NOW, ...over },
    prismaMock as any,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.substitution.aggregate.mockResolvedValue(NO_SPAN)
})

const OWN_WORK = { ownWorkOnly: false, substituteUntil: null }

describe('titular', () => {
  it('lee y califica su libreta', async () => {
    expect(await call({ userId: 'titular-1' })).toEqual({
      level: 'OWNER',
      canRead: true,
      canGrade: true,
      canPlan: true,
      ...OWN_WORK,
    })
  })

  it('no consulta suplencias si ya es titular', async () => {
    await call({ userId: 'titular-1' })
    expect(prismaMock.substitution.aggregate).not.toHaveBeenCalled()
  })
})

describe('suplente: acceso provisional a lo suyo', () => {
  it('mientras dura su suplencia agrega notas, pero sólo ve y toca lo suyo', async () => {
    substituted('2026-06-10', '2026-06-20')
    expect(await call({ userId: 'suplente-1' })).toEqual({
      level: 'SUBSTITUTE',
      canRead: true,
      canGrade: true,
      // Planificar, poner C y R o cerrar es del titular.
      canPlan: false,
      ownWorkOnly: true,
      // Fin del 27/6 en Uruguay: la última clase (20/6) más 7 días.
      substituteUntil: new Date('2026-06-28T02:59:59.999Z'),
    })
  })

  it('busca la suplencia por el scope de la libreta, no por un evento suelto', async () => {
    substituted('2026-06-10')
    await call({ userId: 'suplente-1' })
    expect(prismaMock.substitution.aggregate.mock.calls[0][0].where).toMatchObject({
      substituteUserId: 'suplente-1',
      event: { schoolYearId: 'sy-1', courseOfferingId: 'off-1', subjectId: 'sub-1' },
    })
  })

  it('sin gradebook.grade entra, pero no agrega notas', async () => {
    substituted('2026-06-10', '2026-06-20')
    const access = await call({ userId: 'suplente-1', gradeScope: null })
    expect(access.canRead).toBe(true)
    expect(access.canGrade).toBe(false)
  })
})

describe('suplente fuera de su plazo', () => {
  it('quien cubrió un día de marzo ya no entra en junio: ni lee', async () => {
    substituted('2026-03-10')
    expect(await call({ userId: 'suplente-1' })).toEqual({
      level: 'NONE',
      canRead: false,
      canGrade: false,
      canPlan: false,
      ...OWN_WORK,
    })
  })

  it('una suplencia futura todavía no abre la libreta', async () => {
    substituted('2026-07-01', '2026-07-31')
    expect((await call({ userId: 'suplente-1' })).level).toBe('NONE')
  })

  it('si además supervisa, decide la rama de supervisión', async () => {
    substituted('2026-06-10')
    expect(
      await call({ userId: 'admin-1', readScope: 'all', gradeScope: 'own', planScope: 'all' }),
    ).toEqual({ level: 'SUPERVISION', canRead: true, canGrade: false, canPlan: true, ...OWN_WORK })
  })
})

describe('isSubstituteAccessOpen', () => {
  const span = { first: new Date('2026-06-01T03:00:00.000Z'), last: new Date('2026-06-05T03:00:00.000Z') }

  it('abre en la primera clase cubierta y cierra 7 días después de la última', () => {
    expect(isSubstituteAccessOpen(span, new Date('2026-05-31T23:00:00.000Z'))).toBe(false)
    expect(isSubstituteAccessOpen(span, new Date('2026-06-01T03:00:00.000Z'))).toBe(true)
    // Último día (5/6) entero + 7 días: hasta el fin del 12/6 en Uruguay.
    expect(isSubstituteAccessOpen(span, new Date('2026-06-13T02:59:00.000Z'))).toBe(true)
    expect(isSubstituteAccessOpen(span, new Date('2026-06-13T03:01:00.000Z'))).toBe(false)
    expect(substituteAccessUntil(span)).toEqual(new Date('2026-06-13T02:59:59.999Z'))
  })
})

describe('docente ajeno', () => {
  it('no accede a una libreta que no es suya ni suplió', async () => {
    expect(await call({ userId: 'ajeno-1' })).toEqual({
      level: 'NONE',
      canRead: false,
      canGrade: false,
      canPlan: false,
      ...OWN_WORK,
    })
  })
})

describe('supervisión (alcance all)', () => {
  it('adscripción y dirección leen todo pero NO califican', async () => {
    // Tienen gradebook.read con alcance all y no tienen gradebook.grade.
    expect(
      await call({ userId: 'adscripto-1', readScope: 'all', gradeScope: null, planScope: null }),
    ).toEqual({ level: 'SUPERVISION', canRead: true, canGrade: false, canPlan: false, ...OWN_WORK })
  })

  it('administración con grade all sí puede escribir', async () => {
    expect(
      await call({ userId: 'admin-1', readScope: 'all', gradeScope: 'all', planScope: 'all' }),
    ).toEqual({ level: 'SUPERVISION', canRead: true, canGrade: true, canPlan: true, ...OWN_WORK })
  })

  it('dirección planifica una libreta ajena pero no la califica', async () => {
    // Es la regla del liceo: el director corrige la libreta salvo calificaciones y juicios.
    expect(
      await call({ userId: 'director-1', readScope: 'all', gradeScope: null, planScope: 'all' }),
    ).toEqual({ level: 'SUPERVISION', canRead: true, canGrade: false, canPlan: true, ...OWN_WORK })
  })

  it('un alcance amplio no se busca suplencias: no hace falta', async () => {
    await call({ userId: 'adscripto-1', readScope: 'all', gradeScope: null, planScope: null })
    expect(prismaMock.substitution.aggregate).not.toHaveBeenCalled()
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
