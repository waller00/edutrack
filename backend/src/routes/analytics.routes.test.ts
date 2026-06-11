import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, getPlannedInstancesMock, resolveMock, resolveSchoolYearMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn().mockResolvedValue([]) },
    medicalLeave: { count: vi.fn().mockResolvedValue(0) },
  },
  getPlannedInstancesMock: vi.fn(),
  resolveMock: vi.fn(),
  resolveSchoolYearMock: vi.fn().mockResolvedValue('sy-1'),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/analytics/planInstances.js', () => ({ getPlannedInstances: getPlannedInstancesMock }))
vi.mock('../services/analytics/resolveInstances.js', () => ({ resolveAttendanceAndJustification: resolveMock }))
vi.mock('../services/school-year-service.js', () => ({ resolveSchoolYearIdForList: resolveSchoolYearMock }))

import analyticsRoutes from './analytics.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/analytics', analyticsRoutes)
  return a
}

const adminHdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: 'adm', id: 'adm', email: 'a@a.com', role: 'ADMIN' })}` })

function fixtureInstances() {
  const mk = (status: string, date: string, role: string) => ({
    planned: {
      plannedInstanceId: `${date}_${role}`,
      eventId: 'e1',
      eventTitle: 'Clase',
      eventType: 'CLASE',
      eventStatus: 'ACTIVE',
      isRecurringInstance: false,
      plannedDate: date,
      plannedStartTime: null,
      plannedEndTime: null,
      userIdRequired: `u-${role}`,
      courseOfferingId: 'off-1',
      courseLabel: '1ºA',
      subjectLabel: 'Mate',
    },
    checkInStatusResolved: status,
    checkOutStatusResolved: 'EXIT',
    hasCheckIn: true,
    hasCheckOut: false,
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 30,
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: `Usuario ${role}`,
    userRole: role,
    userEmail: 'u@e.test',
  })
  return [mk('PRESENT', '2026-05-01', 'TEACHER'), mk('LATE', '2026-05-08', 'STAFF')]
}

describe('analytics /dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPlannedInstancesMock.mockResolvedValue([])
    resolveMock.mockResolvedValue(fixtureInstances())
    resolveSchoolYearMock.mockResolvedValue('sy-1')
  })

  it('400 con parámetros inválidos', async () => {
    const res = await request(app()).get('/analytics/dashboard?from=mal&to=2026-05-31').set(adminHdr())
    expect(res.status).toBe(400)
  })

  it('devuelve KPIs, desgloses, distribución, seriesMulti y comparación', async () => {
    const res = await request(app())
      .get('/analytics/dashboard?from=2026-05-01&to=2026-05-31&granularity=week')
      .set(adminHdr())
    expect(res.status).toBe(200)
    expect(res.body.kpis).toBeDefined()
    expect(Array.isArray(res.body.seriesMulti)).toBe(true)
    expect(res.body.breakdowns.byRole.length).toBeGreaterThan(0)
    expect(res.body.breakdowns.byCourse[0].label).toBe('1ºA')
    expect(res.body.statusDistribution.rows.length).toBeGreaterThan(0)
    expect(res.body.comparison).not.toBeNull()
    expect(res.body.comparison.deltas).toBeDefined()
    expect(res.body.meta.granularity).toBe('week')
  })

  it('omite la comparación cuando compareToPrevious=0', async () => {
    const res = await request(app())
      .get('/analytics/dashboard?from=2026-05-01&to=2026-05-31&compareToPrevious=0')
      .set(adminHdr())
    expect(res.status).toBe(200)
    expect(res.body.comparison).toBeNull()
  })

  it('soporta granularidad mensual', async () => {
    const res = await request(app())
      .get('/analytics/dashboard?from=2026-05-01&to=2026-07-31&granularity=month')
      .set(adminHdr())
    expect(res.status).toBe(200)
    expect(res.body.meta.granularity).toBe('month')
  })
})
