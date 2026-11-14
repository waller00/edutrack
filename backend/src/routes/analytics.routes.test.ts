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
  auditMock,
} = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    schoolYear: { findUnique: vi.fn().mockResolvedValue({ label: 'Ciclo 2026' }) },
    event: { findMany: vi.fn().mockResolvedValue([]) },
    attendance: { findMany: vi.fn().mockResolvedValue([]) },
    biometricPunch: { findMany: vi.fn().mockResolvedValue([]) },
    medicalLeave: { count: vi.fn().mockResolvedValue(0) },
    studentAttendanceSession: { findMany: vi.fn().mockResolvedValue([]) },
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
  auditMock: { recordDataExport: vi.fn() },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/analytics/planInstances.js', () => ({ getPlannedInstances: getPlannedInstancesMock }))
vi.mock('../services/analytics/resolveInstances.js', () => ({ resolveAttendanceAndJustification: resolveMock }))
vi.mock('../services/analytics/resolveSubstituteInstances.js', () => ({ resolveSubstituteInstances: resolveSubstituteMock }))
vi.mock('../services/school-year-service.js', () => ({ resolveSchoolYearIdForList: resolveSchoolYearMock }))
vi.mock('../config/system-settings.js', () => ({ getAttendanceOperationalSettings: getAttendanceSettingsMock }))
vi.mock('../services/audit-log.js', () => auditMock)
vi.mock('../services/institution-branding.js', () => ({ loadInstitutionBranding: vi.fn().mockResolvedValue({ name: 'Liceo', logo: null }) }))

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
  prismaMock.studentAttendanceSession.findMany.mockResolvedValue([])
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

  it('el período anterior se busca sin acotarlo al ciclo: casi siempre cae en el ciclo de antes', async () => {
    const res = await request(app())
      .get('/analytics/dashboard?from=2026-03-02&to=2026-10-30&schoolYearId=00000000-0000-4000-8000-000000000001')
      .set(adminHdr())

    expect(res.status).toBe(200)
    const [current, previous] = getPlannedInstancesMock.mock.calls.map((call) => call[0])
    expect(current).toMatchObject({ from: '2026-03-02', to: '2026-10-30', schoolYearId: 'sy-1' })
    expect(previous.from).toBe(res.body.comparison.previousFrom)
    expect(previous.schoolYearId).toBeUndefined()
    expect(resolveSubstituteMock.mock.calls[1][0].schoolYearId).toBeUndefined()
  })

  it('sin clases en el período anterior no inventa una variación contra cero', async () => {
    resolveMock.mockResolvedValueOnce(fixtureInstances()).mockResolvedValueOnce([])

    const res = await request(app())
      .get('/analytics/dashboard?from=2026-05-01&to=2026-05-31')
      .set(adminHdr())

    expect(res.status).toBe(200)
    expect(res.body.kpis).toBeDefined()
    expect(res.body.comparison).toBeNull()
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

  it('cada clase dice si la lista de alumnos se pasó, quién y cuándo abre', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T13:30:00.000Z'))
    prismaMock.studentAttendanceSession.findMany.mockResolvedValue([
      {
        eventId: 'event-1',
        status: 'TAKEN',
        takenAt: new Date('2026-06-25T13:07:00.000Z'),
        takenBy: { id: 'teacher-1', name: 'Ana Docente' },
      },
    ])

    const res = await request(app()).get('/analytics/attendance-timeline?date=2026-06-25').set(adminHdr())

    expect(prismaMock.studentAttendanceSession.findMany.mock.calls[0][0].where).toEqual({ occurrenceYmd: '2026-06-25' })
    const item = res.body.items.find((row: any) => row.id === 'class:event-1_2026-06-25')
    expect(item.rollCall).toEqual({
      eventId: 'event-1',
      ymd: '2026-06-25',
      status: 'TAKEN',
      takenAt: '2026-06-25T13:07:00.000Z',
      takenBy: 'Ana Docente',
      opensAt: '2026-06-25T12:50:00.000Z',
      endAt: '2026-06-25T14:00:00.000Z',
    })
  })

  it('sin lista pasada, la clase queda pendiente', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T13:30:00.000Z'))

    const res = await request(app()).get('/analytics/attendance-timeline?date=2026-06-25').set(adminHdr())

    const item = res.body.items.find((row: any) => row.id === 'class:event-1_2026-06-25')
    expect(item.rollCall).toMatchObject({ status: 'PENDING', takenAt: null, takenBy: null })
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

describe('analytics /report', () => {
  const tokenFor = (role: string, permissions?: Record<string, 'own' | 'all'>) => ({
    Authorization: `Bearer ${signAccessToken({ sub: `${role}-1`, id: `${role}-1`, email: 'x@x.com', role: role as 'ADMIN', permissions })}`,
  })
  const PATH = '/analytics/report?from=2026-05-01&to=2026-05-31&granularity=week'

  beforeEach(() => {
    vi.clearAllMocks()
    getPlannedInstancesMock.mockResolvedValue([])
    resolveMock.mockResolvedValue(fixtureInstances())
    resolveSubstituteMock.mockResolvedValue([])
    resolveSchoolYearMock.mockResolvedValue('sy-1')
    prismaMock.medicalLeave.count.mockResolvedValue(0)
    prismaMock.schoolYear.findUnique.mockResolvedValue({ label: 'Ciclo 2026' })
  })

  it('el PDF sale del mismo cálculo que el tablero, con su nombre de archivo', async () => {
    const res = await request(app()).get(`${PATH}&format=pdf`).set(adminHdr()).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('Indicadores del personal 01-05-2026 a 31-05-2026.pdf')
    expect(Buffer.from(res.body).subarray(0, 5).toString()).toBe('%PDF-')
    // Titular y suplentes, igual que la pantalla.
    expect(resolveSubstituteMock).toHaveBeenCalled()
  })

  it('el Excel también', async () => {
    const res = await request(app()).get(`${PATH}&format=xlsx`).set(adminHdr()).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('cada descarga queda en la auditoría, sólo con ids y filtros', async () => {
    const userId = '11111111-1111-4111-8111-111111111111'
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Ana Pérez', firstName: null, lastName: null, email: 'ana@x.com' })
    await request(app()).get(`${PATH}&format=pdf&userId=${userId}&eventType=CLASE`).set(adminHdr())
    expect(auditMock.recordDataExport).toHaveBeenCalledTimes(1)
    const [, entry] = auditMock.recordDataExport.mock.calls[0]
    expect(entry).toMatchObject({ kind: 'staff-indicators-report', format: 'pdf', entityId: userId })
    expect(entry.details).toMatchObject({ from: '2026-05-01', to: '2026-05-31', eventType: 'CLASE', schoolYearId: 'sy-1' })
    expect(JSON.stringify(entry)).not.toMatch(/Ana|ana@x\.com/)
  })

  it('exportar datos del personal pide además exports.create', async () => {
    const res = await request(app()).get(`${PATH}&format=pdf`).set(tokenFor('TEACHER', { 'analytics.read': 'all' }))
    expect(res.status).toBe(403)
    expect(auditMock.recordDataExport).not.toHaveBeenCalled()
  })

  it('Secretaría lo descarga', async () => {
    const res = await request(app()).get(`${PATH}&format=xlsx`).set(tokenFor('SECRETARIA'))
    expect(res.status).toBe(200)
  })

  it('400 con un formato que no existe', async () => {
    const res = await request(app()).get(`${PATH}&format=docx`).set(adminHdr())
    expect(res.status).toBe(400)
  })

  it('un error no le muestra al cliente el detalle interno', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveMock.mockRejectedValue(new Error('SELECT * FROM "User" falló'))
    const res = await request(app()).get(`${PATH}&format=pdf`).set(adminHdr())
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('SELECT')
    spy.mockRestore()
  })
})

describe('analytics /dashboard: lo que agrega para el informe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPlannedInstancesMock.mockResolvedValue([])
    resolveMock.mockResolvedValue(fixtureInstances())
    resolveSubstituteMock.mockResolvedValue([])
    resolveSchoolYearMock.mockResolvedValue('sy-1')
  })

  it('trae los conteos de cada porcentaje y la lectura del período', async () => {
    const res = await request(app()).get('/analytics/dashboard?from=2026-05-01&to=2026-05-31').set(adminHdr())
    expect(res.status).toBe(200)
    expect(res.body.counts).toMatchObject({ planned: 2, present: 2, onTime: 1, late: 1, absent: 0 })
    expect(res.body.breakdowns.byRole[0].counts.planned).toBe(1)
    expect(Array.isArray(res.body.signals)).toBe(true)
    expect(res.body.signals.length).toBeGreaterThan(0)
  })

  it('un error no le muestra al cliente el detalle interno', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'))
    const res = await request(app()).get('/analytics/dashboard?from=2026-05-01&to=2026-05-31').set(adminHdr())
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ message: 'Error interno del servidor' })
    spy.mockRestore()
  })
})
