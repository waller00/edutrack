import { expect, it, vi } from 'vitest'
vi.mock('../db/prisma.js', () => ({ prisma: {} }))
import { resolveGradeBookAccess } from '../services/gradebook/access.js'
import { resolveGradeEditPermissions } from '../services/gradebook/edit-window.js'
it('AUD-03: a historical substitution allows grading a current assessment outside its day', async () => {
  const findFirst = vi.fn(async () => ({ id: 'substitution-in-march' }))
  const access = await resolveGradeBookAccess({ userId: 'substitute', readScope: 'own', gradeScope: 'own', planScope: 'own',
    gradeBook: { teacherUserId: 'owner', schoolYearId: '2026', courseOfferingId: 'group', subjectId: 'math', orientationId: null, courseOrientationId: null, status: 'ACTIVE' },
  }, { substitution: { findFirst } } as any)
  expect(access.level).toBe('SUBSTITUTE')
  expect(access.canGrade).toBe(true)
  const where = findFirst.mock.calls[0][0].where
  expect(where).not.toHaveProperty('date')
  const permissions = resolveGradeEditPermissions({ gradeScope: 'own', canManage: false,
    isResponsible: access.level === 'SUBSTITUTE', assessmentDate: new Date('2026-10-13T12:00:00Z'),
    now: new Date('2026-10-14T12:00:00Z'), windowDays: 7, gradeBookStatus: 'ACTIVE' })
  expect(permissions.canEdit).toBe(true)
})
