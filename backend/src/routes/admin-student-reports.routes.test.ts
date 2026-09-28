import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, reportsMock } = vi.hoisted(() => ({
  prismaMock: {
    studentAlert: { findMany: vi.fn() },
  },
  reportsMock: {
    loadLowGrades: vi.fn(),
    loadGradeDrops: vi.fn(),
    loadAbsenceStreaks: vi.fn(),
    loadAbsenceThresholds: vi.fn(),
  },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/student-reports/reports.js', () => reportsMock)
vi.mock('../services/school-year-service.js', () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue('sy-1'),
}))

import studentReportsRoutes from './admin-student-reports.js'
import { authGuard, requirePermission } from '../middlewares/auth.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  // Se monta igual que en admin.ts.
  a.use('/admin/student-reports', authGuard, requirePermission('student-reports.read', 'all'), studentReportsRoutes)
  return a
}

const tok = (role = 'ADMIN', sub = 'admin-1') => signAccessToken({ sub, email: 'a@a.com', role: role as 'ADMIN' })
const PERIOD = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reportes de estudiantes', () => {
  it('un docente no los ve', async () => {
    const res = await request(app()).get('/admin/student-reports/absence-thresholds').set('Authorization', `Bearer ${tok('TEACHER', 't-1')}`)
    expect(res.status).toBe(403)
  })

  it('notas bajas exige una reunión de boletín', async () => {
    const missing = await request(app()).get('/admin/student-reports/low-grades').set('Authorization', `Bearer ${tok()}`)
    expect(missing.status).toBe(400)

    reportsMock.loadLowGrades.mockResolvedValue(null)
    const notReportCard = await request(app())
      .get(`/admin/student-reports/low-grades?periodId=${PERIOD}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(notReportCard.status).toBe(404)
  })

  it('devuelve el % de notas bajas', async () => {
    reportsMock.loadLowGrades.mockResolvedValue({ period: { id: PERIOD }, rows: [{ percent: 50 }], courses: [] })
    const res = await request(app())
      .get(`/admin/student-reports/low-grades?periodId=${PERIOD}`)
      .set('Authorization', `Bearer ${tok()}`)
    expect(res.status).toBe(200)
    expect(res.body.rows[0].percent).toBe(50)
  })

  it('bajas de boletín, rachas y umbrales', async () => {
    reportsMock.loadGradeDrops.mockResolvedValue({ period: { id: PERIOD }, previous: null, rows: [] })
    reportsMock.loadAbsenceStreaks.mockResolvedValue([{ studentId: 'a' }])
    reportsMock.loadAbsenceThresholds.mockResolvedValue([{ studentId: 'b' }])

    const drops = await request(app()).get(`/admin/student-reports/grade-drops?periodId=${PERIOD}`).set('Authorization', `Bearer ${tok()}`)
    const streaks = await request(app()).get('/admin/student-reports/absence-streaks').set('Authorization', `Bearer ${tok()}`)
    const thresholds = await request(app()).get('/admin/student-reports/absence-thresholds').set('Authorization', `Bearer ${tok()}`)

    expect(drops.body.previous).toBeNull()
    expect(streaks.body.data).toEqual([{ studentId: 'a' }])
    expect(thresholds.body.data).toEqual([{ studentId: 'b' }])
    expect(reportsMock.loadAbsenceStreaks).toHaveBeenCalledWith('sy-1')
  })

  it('la bandeja de alertas filtra por tipo y por ciclo', async () => {
    prismaMock.studentAlert.findMany.mockResolvedValue([])
    await request(app()).get('/admin/student-reports/alerts?type=ABSENCE_STREAK').set('Authorization', `Bearer ${tok()}`)
    expect(prismaMock.studentAlert.findMany.mock.calls[0][0].where).toEqual({ schoolYearId: 'sy-1', type: 'ABSENCE_STREAK' })

    const bad = await request(app()).get('/admin/student-reports/alerts?type=OTRA').set('Authorization', `Bearer ${tok()}`)
    expect(bad.status).toBe(400)
  })
})
