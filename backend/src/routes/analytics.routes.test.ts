import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const {
  prismaMock,
  getPlannedInstancesMock,
  resolveMock,
  resolveSubstituteMock,
  resolveSchoolYearMock,
  getAttendanceSettingsMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn().mockResolvedValue([]) },
    event: { findMany: vi.fn().mockResolvedValue([]) },
    attendance: { findMany: vi.fn().mockResolvedValue([]) },
    biometricPunch: { findMany: vi.fn().mockResolvedValue([]) },
    medicalLeave: { count: vi.fn().mockResolvedValue(0) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
  getPlannedInstancesMock: vi.fn(),
  resolveMock: vi.fn(),
  resolveSubstituteMock: vi.fn(),
  resolveSchoolYearMock: vi.fn().mockResolvedValue('sy-1'),
  getAttendanceSettingsMock: vi.fn().mockResolvedValue({
    noShowGraceMinutes: 15,
    lateToleranceMinutes: 5,
    earlyExitToleranceMinutes: 5,
    classBridgeGapMinutes: 60,
    monitorEnabled: true,
    monitorIntervalMs: 120000,
    biometricDuplicateWindowMinutes: 5,
  }),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/analytics/planInstances.js', () => ({ getPlannedInstances: getPlannedInstancesMock }))
vi.mock('../services/analytics/resolveInstances.js', () => ({ resolveAttendanceAndJustification: resolveMock }))
vi.mock('../services/analytics/resolveSubstituteInstances.js', () => ({ resolveSubstituteInstances: resolveSubstituteMock }))
vi.mock('../services/school-year-service.js', () => ({ resolveSchoolYearIdForList: resolveSchoolYearMock }))
vi.mock('../config/system-settings.js', () => ({ getAttendanceOperationalSettings: getAttendanceSettingsMock }))

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

function timelinePlannedInstance() {
  return {
    plannedInstanceId: 'event-1_2026-06-25',
    eventId: 'event-1',
    eventTitle: 'Clase de Historia',
    eventType: 'CLASE',
    eventStatus: 'SCHEDULED',
    isRecurringInstance: false,
    plannedDate: '2026-06-25',
    plannedStartTime: new Date('2026-06-25T13:00:00.000Z'),
    plannedEndTime: new Date('2026-06-25T14:00:00.000Z'),
    userIdRequired: 'teacher-1',
    courseOfferingId: 'off-1',
    courseLabel: '1A',
    subjectLabel: 'Historia',
  }
}

function timelineResolved(status = 'ABSENT_NOT_JUSTIFIED') {
  const planned = timelinePlannedInstance()
  return {
    planned,
    checkInStatusResolved: status,
    checkOutStatusResolved: status,
    hasCheckIn: false,
    hasCheckOut: false,
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 0,
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: 'Ana Docente',
    userRole: 'TEACHER',
    userEmail: 'ana@example.com',
  }
}

function timelineEvent() {
  return {
    id: 'event-1',
    title: 'Clase de Historia',
    status: 'SCHEDULED',
    startTime: new Date('2026-06-25T13:00:00.000Z'),
    endTime: new Date('2026-06-25T14:00:00.000Z'),
    assignedUserId: 'teacher-1',
    assignedUser: {
      id: 'teacher-1',
      name: 'Ana Docente',
      email: 'ana@example.com',
      firstName: null,
      lastName: null,
    },
    subject: { id: 'subject-1', name: 'Historia' },
    courseOffering: { courseId: 'course-1', course: { id: 'course-1', name: '1A', code: '1A' } },
  }
}

function setupTimelineMocks() {
  getPlannedInstancesMock.mockResolvedValue([timelinePlannedInstance()])
  resolveMock.mockResolvedValue([timelineResolved()])
  resolveSubstituteMock.mockResolvedValue([])
  resolveSchoolYearMock.mockResolvedValue('sy-1')
  prismaMock.event.findMany.mockResolvedValueOnce([timelineEvent()]).mockResolvedValueOnce([])
  prismaMock.attendance.findMany.mockResolvedValue([])
  prismaMock.biometricPunch.findMany.mockResolvedValue([])
  prismaMock.$queryRaw.mockResolvedValue([])
}

describe('analytics /dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    getPlannedInstancesMock.mockResolvedValue([])
    resolveMock.mockResolvedValue(fixtureInstances())
    resolveSubstituteMock.mockResolvedValue([])
    resolveSchoolYearMock.mockResolvedValue('sy-1')
    getAttendanceSettingsMock.mockResolvedValue({
      noShowGraceMinutes: 15,
      lateToleranceMinutes: 5,
      earlyExitToleranceMinutes: 5,
      classBridgeGapMinutes: 60,
      monitorEnabled: true,
      monitorIntervalMs: 120000,
      biometricDuplicateWindowMinutes: 5,
    })
    prismaMock.event.findMany.mockResolvedValue([])
    prismaMock.attendance.findMany.mockResolvedValue([])
    prismaMock.biometricPunch.findMany.mockResolvedValue([])
    prismaMock.$queryRaw.mockResolvedValue([])
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

describe('analytics /attendance-timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAttendanceSettingsMock.mockResolvedValue({
      noShowGraceMinutes: 15,
      lateToleranceMinutes: 5,
      earlyExitToleranceMinutes: 5,
      classBridgeGapMinutes: 60,
      monitorEnabled: true,
      monitorIntervalMs: 120000,
      biometricDuplicateWindowMinutes: 5,
    })
    setupTimelineMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('no muestra ausencia pendiente antes del inicio de la clase', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T12:00:00.000Z'))

    const res = await request(app()).get('/analytics/attendance-timeline?date=2026-06-25').set(adminHdr())

    expect(res.status).toBe(200)
    expect(res.body.summary.pendingAbsences).toBe(0)
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class:event-1_2026-06-25',
          type: 'CLASS_ATTENDANCE',
          status: 'SCHEDULED',
          statusLabel: 'Programada',
        }),
      ]),
    )
    expect(res.body.items.some((item: any) => item.type === 'PENDING_ABSENCE')).toBe(false)
  })

  it('muestra ausencia pendiente después de la tolerancia de no-show', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T13:16:00.000Z'))

    const res = await request(app()).get('/analytics/attendance-timeline?date=2026-06-25').set(adminHdr())

    expect(res.status).toBe(200)
    expect(res.body.summary.pendingAbsences).toBe(1)
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class:event-1_2026-06-25',
          type: 'PENDING_ABSENCE',
          status: 'PENDING',
          statusLabel: 'Pendiente',
        }),
      ]),
    )
  })
})
