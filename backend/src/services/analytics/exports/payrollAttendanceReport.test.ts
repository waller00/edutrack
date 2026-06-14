import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { PlannedInstance, ResolvedAttendanceByInstance } from '../models.js'

const { prismaMock, getPlannedInstancesMock, resolveMock, scopeUserIdsMock, scopeSchoolYearMock } = vi.hoisted(() => ({
  prismaMock: {
    substitution: { findMany: vi.fn().mockResolvedValue([]) },
    attendance: { findMany: vi.fn().mockResolvedValue([]) },
  },
  getPlannedInstancesMock: vi.fn().mockResolvedValue([]),
  resolveMock: vi.fn().mockResolvedValue([]),
  scopeUserIdsMock: vi.fn().mockResolvedValue(null),
  scopeSchoolYearMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../planInstances.js', () => ({ getPlannedInstances: getPlannedInstancesMock }))
vi.mock('../resolveInstances.js', () => ({ resolveAttendanceAndJustification: resolveMock }))
vi.mock('./exportScope.js', () => ({
  scopeUserIdsFor: scopeUserIdsMock,
  resolveScopedSchoolYearId: scopeSchoolYearMock,
}))

import {
  buildPayrollAttendanceData,
  generatePayrollAttendanceCsv,
  generatePayrollAttendancePdf,
  generatePayrollAttendanceXlsx,
} from './payrollAttendanceReport.js'

function planned(p: Partial<PlannedInstance> & Pick<PlannedInstance, 'plannedInstanceId' | 'eventId' | 'plannedDate'>): PlannedInstance {
  return {
    eventTitle: 'Clase Matemática',
    eventType: 'CLASE',
    eventStatus: 'SCHEDULED',
    isRecurringInstance: false,
    plannedStartTime: new Date('2026-05-01T11:00:00.000Z'), // 08:00 UY
    plannedEndTime: new Date('2026-05-01T12:00:00.000Z'), // 09:00 UY (1h)
    userIdRequired: 'u1',
    courseOfferingId: null,
    courseLabel: null,
    subjectLabel: null,
    ...p,
  }
}

function titular(
  status: ResolvedAttendanceByInstance['checkInStatusResolved'],
  date: string,
  extra: Partial<ResolvedAttendanceByInstance> = {},
): ResolvedAttendanceByInstance {
  return {
    planned: planned({ plannedInstanceId: `e1_${date}`, eventId: 'e1', plannedDate: date }),
    checkInStatusResolved: status,
    checkOutStatusResolved: status === 'PRESENT' ? 'EXIT' : status,
    hasCheckIn: status === 'PRESENT' || status === 'LATE',
    hasCheckOut: status === 'PRESENT',
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 0,
    isJustifiedAbsence: status === 'ABSENT_JUSTIFIED',
    licenseIdJustifying: status === 'ABSENT_JUSTIFIED' ? 'lic-1' : null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: 'Titular Uno',
    userRole: 'TEACHER',
    userEmail: 'u1@edu.test',
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  scopeUserIdsMock.mockResolvedValue(null)
  scopeSchoolYearMock.mockResolvedValue(undefined)
  prismaMock.substitution.findMany.mockResolvedValue([])
  prismaMock.attendance.findMany.mockResolvedValue([])
})

describe('buildPayrollAttendanceData', () => {
  it('agrupa por persona y cuenta esperadas + desglose de estados (sin fichaje, licencia, suplido)', async () => {
    resolveMock.mockResolvedValue([
      titular('ABSENT_NOT_JUSTIFIED', '2026-05-01'),
      titular('ABSENT_JUSTIFIED', '2026-05-02'),
      titular('SUBSTITUTED', '2026-05-03'),
    ])

    const data = await buildPayrollAttendanceData({
      from: '2026-05-01',
      to: '2026-05-31',
      filters: {},
    })

    expect(data.persons).toHaveLength(1)
    const p = data.persons[0]
    expect(p.userId).toBe('u1')
    expect(p.stats.esperadas).toBe(3)
    expect(p.stats.ausenteNoJustificado).toBe(1)
    expect(p.stats.ausenteJustificado).toBe(1)
    expect(p.stats.suplido).toBe(1)
    expect(p.stats.presente).toBe(0)
    // 3 instancias de 1h planificada cada una, ninguna trabajada
    expect(p.stats.horasPlanificadas).toBe(3)
    expect(p.stats.horasTrabajadas).toBe(0)
    expect(p.stats.deltaHoras).toBe(-3)
    expect(p.stats.pctAusentismo).toBe(100)
    // El titular suplido no muestra horas reales
    const suplidoRow = p.rows.find((r) => r.estado === 'Suplido')!
    expect(suplidoRow.horaRealIn).toBe('')
  })

  it('inyecta cobertura del suplente como presencia + horas planificadas', async () => {
    resolveMock.mockResolvedValue([titular('SUBSTITUTED', '2026-05-02')])
    prismaMock.substitution.findMany.mockResolvedValue([
      {
        eventId: 'e1',
        substituteUserId: 'u2',
        date: new Date('2026-05-02T12:00:00.000Z'),
        startTime: new Date('2026-05-02T11:00:00.000Z'), // 08:00 UY
        endTime: new Date('2026-05-02T12:00:00.000Z'), // 09:00 UY (1h)
        reason: 'Licencia titular',
        event: { id: 'e1', title: 'Clase Matemática', type: 'CLASE', status: 'SCHEDULED' },
        substitute: {
          id: 'u2',
          name: 'Suplente Dos',
          username: 'sup2',
          firstName: null,
          lastName: null,
          email: 'u2@edu.test',
          orgRole: { code: 'TEACHER' },
        },
      },
    ])

    const data = await buildPayrollAttendanceData({ from: '2026-05-01', to: '2026-05-31', filters: {} })

    const suplente = data.persons.find((p) => p.userId === 'u2')!
    expect(suplente).toBeTruthy()
    expect(suplente.stats.esperadas).toBe(1)
    expect(suplente.stats.cobertura).toBe(1)
    expect(suplente.stats.presente).toBe(1)
    expect(suplente.stats.horasTrabajadas).toBe(1) // sin fichaje → duración planificada
    expect(suplente.stats.pctAsistencia).toBe(100)
    expect(suplente.rows[0].estado).toBe('Cobertura (suplencia)')

    // El titular sigue apareciendo con el suplido
    const titularP = data.persons.find((p) => p.userId === 'u1')!
    expect(titularP.stats.suplido).toBe(1)
    // Total general acumula ambos
    expect(data.total.esperadas).toBe(2)
  })

  it('aplica el filtro de estado post-resolución', async () => {
    resolveMock.mockResolvedValue([
      titular('PRESENT', '2026-05-01', { durationMinutes: 60, actualInTime: new Date('2026-05-01T11:00:00.000Z') }),
      titular('ABSENT_NOT_JUSTIFIED', '2026-05-02'),
    ])

    const data = await buildPayrollAttendanceData({
      from: '2026-05-01',
      to: '2026-05-31',
      filters: { status: 'ABSENT_NOT_JUSTIFIED' },
    })

    expect(data.total.esperadas).toBe(1)
    expect(data.total.ausenteNoJustificado).toBe(1)
    expect(data.total.presente).toBe(0)
  })

  it('no incluye cobertura cuando se filtra por un tipo de evento distinto de CLASE', async () => {
    resolveMock.mockResolvedValue([])
    await buildPayrollAttendanceData({
      from: '2026-05-01',
      to: '2026-05-31',
      filters: { eventType: 'JORNADA_LABORAL' },
    })
    expect(prismaMock.substitution.findMany).not.toHaveBeenCalled()
  })

  it('renderiza XLSX/PDF/CSV sin error y con contenido', async () => {
    resolveMock.mockResolvedValue([
      titular('PRESENT', '2026-05-01', { durationMinutes: 60, actualInTime: new Date('2026-05-01T11:00:00.000Z'), actualOutTime: new Date('2026-05-01T12:00:00.000Z') }),
      titular('ABSENT_NOT_JUSTIFIED', '2026-05-02'),
    ])

    const data = await buildPayrollAttendanceData({ from: '2026-05-01', to: '2026-05-31', filters: {} })

    const xlsx = await generatePayrollAttendanceXlsx(data)
    expect(Buffer.isBuffer(xlsx)).toBe(true)
    expect(xlsx.length).toBeGreaterThan(0)

    const pdf = await generatePayrollAttendancePdf(data)
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(0)

    const csv = generatePayrollAttendanceCsv(data)
    expect(csv).toContain('Persona,Rol,Fecha')
    expect(csv).toContain('Titular Uno')
  })
})
