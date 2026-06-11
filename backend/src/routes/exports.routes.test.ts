import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const {
  prismaMock,
  getPlannedInstancesMock,
  resolveMock,
  dimensionXlsxMock,
  dimensionPdfMock,
  attendanceXlsxMock,
  attendanceCsvMock,
  attendancePdfMock,
  monthlyPdfMock,
  resolveSchoolYearMock,
} = vi.hoisted(() => ({
  prismaMock: { user: { findMany: vi.fn().mockResolvedValue([]) }, medicalLeave: { count: vi.fn().mockResolvedValue(0) } },
  getPlannedInstancesMock: vi.fn().mockResolvedValue([]),
  resolveMock: vi.fn().mockResolvedValue([]),
  dimensionXlsxMock: vi.fn().mockResolvedValue(Buffer.from('xlsx')),
  dimensionPdfMock: vi.fn().mockResolvedValue(Buffer.from('pdf')),
  attendanceXlsxMock: vi.fn().mockResolvedValue(Buffer.from('axlsx')),
  attendanceCsvMock: vi.fn().mockResolvedValue('a;b;c'),
  attendancePdfMock: vi.fn().mockResolvedValue(Buffer.from('apdf')),
  monthlyPdfMock: vi.fn().mockResolvedValue(Buffer.from('mpdf')),
  resolveSchoolYearMock: vi.fn().mockResolvedValue('sy-1'),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/analytics/planInstances.js', () => ({ getPlannedInstances: getPlannedInstancesMock }))
vi.mock('../services/analytics/resolveInstances.js', () => ({ resolveAttendanceAndJustification: resolveMock }))
vi.mock('../services/analytics/exports/dimensionReportExport.js', () => ({
  generateDimensionReportXlsx: dimensionXlsxMock,
  generateDimensionReportPdf: dimensionPdfMock,
}))
vi.mock('../services/analytics/exports/attendanceAssistanceReportExport.js', () => ({
  generateAttendanceAssistanceReportXlsxFromAttendances: attendanceXlsxMock,
  generateAttendanceAssistanceReportPdfFromAttendances: attendancePdfMock,
}))
vi.mock('../services/analytics/exports/attendanceDetailFromAttendancesExport.js', () => ({
  generateAttendanceDetailCsvFromAttendances: attendanceCsvMock,
}))
vi.mock('../services/analytics/exports/monthlySummaryPdf.js', () => ({ generateMonthlySummaryPdf: monthlyPdfMock }))
vi.mock('../services/school-year-service.js', () => ({ resolveSchoolYearIdForList: resolveSchoolYearMock }))

import exportsRoutes from './exports.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/exports', exportsRoutes)
  return a
}

const adminHdr = () => ({ Authorization: `Bearer ${signAccessToken({ sub: 'adm', id: 'adm', email: 'a@a.com', role: 'ADMIN' })}` })

const baseBody = { from: '2026-05-01', to: '2026-05-31' }

describe('exports routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPlannedInstancesMock.mockResolvedValue([])
    resolveMock.mockResolvedValue([])
    resolveSchoolYearMock.mockResolvedValue('sy-1')
  })

  it('400 con body inválido', async () => {
    const res = await request(app()).post('/exports').set(adminHdr()).send({ reportKey: 'nope' })
    expect(res.status).toBe(400)
  })

  it('genera reporte por persona (XLSX) y devuelve downloadUrl', async () => {
    const res = await request(app())
      .post('/exports')
      .set(adminHdr())
      .send({ ...baseBody, reportKey: 'person_report', format: 'XLSX' })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('DONE')
    expect(res.body.downloadUrl).toBeTruthy()
    expect(dimensionXlsxMock).toHaveBeenCalledWith(expect.objectContaining({ dimension: 'person' }))
  })

  it('genera reporte por curso (PDF)', async () => {
    const res = await request(app())
      .post('/exports')
      .set(adminHdr())
      .send({ ...baseBody, reportKey: 'course_report', format: 'PDF' })
    expect(res.status).toBe(201)
    expect(dimensionPdfMock).toHaveBeenCalledWith(expect.objectContaining({ dimension: 'course' }))
  })

  it('rechaza CSV para reporte por persona', async () => {
    const res = await request(app())
      .post('/exports')
      .set(adminHdr())
      .send({ ...baseBody, reportKey: 'person_report', format: 'CSV' })
    expect(res.status).toBe(400)
    expect(dimensionXlsxMock).not.toHaveBeenCalled()
  })

  it('rechaza formato no PDF para resumen mensual', async () => {
    const res = await request(app())
      .post('/exports')
      .set(adminHdr())
      .send({ ...baseBody, reportKey: 'monthly_summary', format: 'XLSX' })
    expect(res.status).toBe(400)
  })

  it('genera detalle de asistencia en XLSX (camino existente)', async () => {
    const res = await request(app())
      .post('/exports')
      .set(adminHdr())
      .send({ ...baseBody, reportKey: 'attendance_detail', format: 'XLSX' })
    expect(res.status).toBe(201)
    expect(attendanceXlsxMock).toHaveBeenCalled()
  })

  it('respeta allYears omitiendo la resolución de ciclo', async () => {
    const res = await request(app())
      .post('/exports')
      .set(adminHdr())
      .send({ ...baseBody, reportKey: 'person_report', format: 'XLSX', filters: { allYears: '1' } })
    expect(res.status).toBe(201)
    expect(resolveSchoolYearMock).not.toHaveBeenCalled()
  })
})
