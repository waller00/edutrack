import { describe, expect, it } from 'vitest'
import { expectValidWhere, invalidNullFilters } from './prisma-where.js'

describe('invalidNullFilters', () => {
  it('marca `{ not: null }` y `null` sobre un campo obligatorio', () => {
    expect(invalidNullFilters('GradeBook', { teacherUserId: 'u', courseOfferingId: { not: null } })).toEqual(['courseOfferingId.not'])
    expect(invalidNullFilters('GradeBook', { courseOfferingId: null })).toEqual(['courseOfferingId'])
  })

  it('un campo opcional sí se puede filtrar por null', () => {
    expect(invalidNullFilters('GradeBook', { teacherUserId: null, courseOrientationId: { not: null } })).toEqual([])
  })

  it('sigue AND/OR/NOT y las relaciones', () => {
    expect(
      invalidNullFilters('GradeBook', {
        OR: [{ status: 'ACTIVE' }, { courseOfferingId: { equals: null } }],
        courseOffering: { is: { courseId: { not: null } } },
      }),
    ).toEqual(['OR[1].courseOfferingId.equals', 'courseOffering.is.courseId.not'])
  })

  it('expectValidWhere falla con un mensaje que dice qué arreglar', () => {
    expect(() => expectValidWhere('GradeBook', { courseOfferingId: { not: null } })).toThrow(/courseOfferingId\.not/)
    expect(() => expectValidWhere('GradeBook', { schoolYearId: 'sy', status: 'ACTIVE' })).not.toThrow()
    expect(() => expectValidWhere('NoExiste', {})).toThrow(/No existe el modelo/)
  })
})
