import { describe, expect, it } from 'vitest'
import { buildRosterEnrollmentWhere, canResolveRoster } from './roster.js'

const base = { schoolYearId: 'sy-1', courseOfferingId: 'co-1' }

describe('buildRosterEnrollmentWhere', () => {
  it('siempre filtra por ciclo, oferta y matrícula activa', () => {
    expect(buildRosterEnrollmentWhere({ ...base, orientationId: null, courseOrientationId: null })).toEqual({
      schoolYearId: 'sy-1',
      courseOfferingId: 'co-1',
      enrollmentStatus: 'ACTIVE',
    })
  })

  it('tronco común: no filtra por orientación', () => {
    const where = buildRosterEnrollmentWhere({ ...base, orientationId: null, courseOrientationId: null })
    expect(where).not.toHaveProperty('orientationId')
    expect(where).not.toHaveProperty('courseOrientationId')
  })

  it('usa orientationId cuando el evento solo trae orientación global', () => {
    const where = buildRosterEnrollmentWhere({ ...base, orientationId: 'or-1', courseOrientationId: null })
    expect(where).toMatchObject({ orientationId: 'or-1' })
    expect(where).not.toHaveProperty('courseOrientationId')
  })

  it('courseOrientationId tiene precedencia sobre orientationId', () => {
    const where = buildRosterEnrollmentWhere({ ...base, orientationId: 'or-1', courseOrientationId: 'cor-1' })
    expect(where).toMatchObject({ courseOrientationId: 'cor-1' })
    expect(where).not.toHaveProperty('orientationId')
  })
})

describe('canResolveRoster', () => {
  it('exige ciclo y oferta de curso', () => {
    expect(canResolveRoster({ schoolYearId: 'sy-1', courseOfferingId: 'co-1' })).toBe(true)
    expect(canResolveRoster({ schoolYearId: 'sy-1', courseOfferingId: null })).toBe(false)
    expect(canResolveRoster({ schoolYearId: null, courseOfferingId: 'co-1' })).toBe(false)
  })
})
