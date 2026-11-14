import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, schoolYearMock, reportMock, auditMock } = vi.hoisted(() => ({
  prismaMock: { academicPeriod: { findUnique: vi.fn() } },
  schoolYearMock: vi.fn(),
  reportMock: { loadStudentIndicatorsReport: vi.fn() },
  auditMock: { recordDataExport: vi.fn() },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/school-year-service.js', () => ({ resolveSchoolYearIdForList: schoolYearMock }))
vi.mock('../services/student-indicators/report.js', () => reportMock)
vi.mock('../services/audit-log.js', () => auditMock)
vi.mock('../services/institution-branding.js', () => ({ loadInstitutionBranding: vi.fn().mockResolvedValue({ name: 'Liceo', logo: null }) }))

import studentIndicatorsRoutes from './admin-student-indicators.js'
import { authGuard, requireAnyPermission } from '../middlewares/auth.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  // Se monta igual que en admin.ts.
  a.use(
    '/admin/student-indicators',
    authGuard,
    requireAnyPermission([
      ['academic-analytics.read', 'all'],
      ['student-reports.read', 'all'],
    ]),
    studentIndicatorsRoutes,
  )
  return a
}

const header = (role: string, permissions?: Record<string, 'own' | 'all'>) => ({
  Authorization: `Bearer ${signAccessToken({ sub: `${role}-1`, email: 'x@x.com', role: role as 'ADMIN', permissions })}`,
})

const PERIOD_ID = '22222222-2222-4222-8222-222222222222'
const REPORT_CARD = { id: PERIOD_ID, name: '2.ª Entrega', level: 'EBI', schoolYearId: 'sy-2026', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true }
const REPORT = {
  title: 'Indicadores de estudiantes',
  subtitle: 'Ciclo 2026 · notas (R) de 2.ª Entrega',
  filters: ['Ciclo lectivo: Ciclo 2026'],
  filename: 'Indicadores de estudiantes Ciclo 2026 - 2.ª Entrega',
  generatedAt: new Date('2026-11-13T17:00:00.000Z'),
  sections: [
    {
      id: 'riesgo',
      title: 'Quién necesita atención',
      blocks: [{ kind: 'table', title: 'Quién necesita atención', sheet: 'Quién', columns: [{ header: 'Estudiante' }], rows: [['Pérez, Ana']], empty: 'Nadie.' }],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  schoolYearMock.mockResolvedValue('sy-2026')
  prismaMock.academicPeriod.findUnique.mockResolvedValue(REPORT_CARD)
  reportMock.loadStudentIndicatorsReport.mockResolvedValue(REPORT)
})

describe('informe de indicadores de estudiantes', () => {
  it('un docente no lo descarga', async () => {
    const res = await request(app()).get('/admin/student-indicators/report?format=pdf').set(header('TEACHER'))
    expect(res.status).toBe(403)
    expect(reportMock.loadStudentIndicatorsReport).not.toHaveBeenCalled()
  })

  it('Secretaría (sin indicadores de estudiantes) tampoco', async () => {
    const res = await request(app()).get('/admin/student-indicators/report?format=pdf').set(header('SECRETARIA'))
    expect(res.status).toBe(403)
  })

  it('Dirección lo baja en PDF con todas sus secciones, del ciclo y boletín de la pantalla', async () => {
    const res = await request(app())
      .get(`/admin/student-indicators/report?format=pdf&schoolYearId=11111111-1111-4111-8111-111111111111&periodId=${PERIOD_ID}`)
      .set(header('DIRECCION'))
      .buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    // El nombre viaja en UTF-8 (`filename*`): la «ª» llega entera.
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('Indicadores de estudiantes Ciclo 2026 - 2.ª Entrega.pdf')}`)
    expect(schoolYearMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ institutionWide: true, requestedSchoolYearId: '11111111-1111-4111-8111-111111111111' }))
    expect(reportMock.loadStudentIndicatorsReport).toHaveBeenCalledWith(
      expect.objectContaining({ schoolYearId: 'sy-2026', period: { id: PERIOD_ID, name: '2.ª Entrega', level: 'EBI' }, access: { analytics: true, reports: true } }),
    )
  })

  it('quien tiene sólo los reportes recibe sólo esas secciones', async () => {
    const res = await request(app())
      .get('/admin/student-indicators/report?format=xlsx')
      .set(header('TEACHER', { 'student-reports.read': 'all' }))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(reportMock.loadStudentIndicatorsReport).toHaveBeenCalledWith(expect.objectContaining({ access: { analytics: false, reports: true }, period: null }))
  })

  it('cada descarga queda en la auditoría, con ids y sin nombres', async () => {
    await request(app()).get(`/admin/student-indicators/report?format=pdf&periodId=${PERIOD_ID}`).set(header('ADMIN'))
    expect(auditMock.recordDataExport).toHaveBeenCalledTimes(1)
    const [, entry] = auditMock.recordDataExport.mock.calls[0]
    expect(entry).toEqual({
      kind: 'student-indicators-report',
      format: 'pdf',
      entityId: 'sy-2026',
      details: { periodId: PERIOD_ID, sections: ['riesgo'] },
    })
    expect(JSON.stringify(entry)).not.toContain('Pérez')
  })

  it('un boletín de otro ciclo (o que no es de boletín) es un 400', async () => {
    prismaMock.academicPeriod.findUnique.mockResolvedValue({ ...REPORT_CARD, schoolYearId: 'sy-2025' })
    const otherYear = await request(app()).get(`/admin/student-indicators/report?format=pdf&periodId=${PERIOD_ID}`).set(header('ADMIN'))
    expect(otherYear.status).toBe(400)
    expect(otherYear.body.code).toBe('PERIOD_MISMATCH')

    prismaMock.academicPeriod.findUnique.mockResolvedValue({ ...REPORT_CARD, requiresConceptualJudgement: false })
    const notReportCard = await request(app()).get(`/admin/student-indicators/report?format=pdf&periodId=${PERIOD_ID}`).set(header('ADMIN'))
    expect(notReportCard.status).toBe(400)
    expect(reportMock.loadStudentIndicatorsReport).not.toHaveBeenCalled()
  })

  it('400 con un formato que no existe o sin ciclo activo', async () => {
    expect((await request(app()).get('/admin/student-indicators/report?format=csv').set(header('ADMIN'))).status).toBe(400)
    schoolYearMock.mockResolvedValue(null)
    expect((await request(app()).get('/admin/student-indicators/report?format=pdf').set(header('ADMIN'))).status).toBe(400)
  })

  it('un error no le muestra al cliente el detalle interno', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportMock.loadStudentIndicatorsReport.mockRejectedValue(new Error('relation "StudentAttendanceEntry" does not exist'))
    const res = await request(app()).get('/admin/student-indicators/report?format=pdf').set(header('ADMIN'))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ message: 'Error interno del servidor' })
    spy.mockRestore()
  })
})
