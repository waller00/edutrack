import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPlannedInstances: vi.fn(),
  resolveAttendanceAndJustification: vi.fn(),
  resolveUserIdsFromSearch: vi.fn(),
}))

vi.mock('../analytics/planInstances.js', () => ({ getPlannedInstances: mocks.getPlannedInstances }))
vi.mock('../analytics/resolveInstances.js', () => ({
  resolveAttendanceAndJustification: mocks.resolveAttendanceAndJustification,
}))
vi.mock('./helpers.js', () => ({ resolveUserIdsFromSearch: mocks.resolveUserIdsFromSearch }))

import { executeAbsencesSummary } from './absences.js'

const HOUR = 3600_000

function plannedInstance(overrides: Record<string, unknown> = {}) {
  return {
    plannedInstanceId: 'ev1_2026-06-11',
    eventId: 'ev1',
    eventTitle: 'Matemática 1A',
    eventType: 'CLASE',
    eventStatus: 'SCHEDULED',
    isRecurringInstance: true,
    plannedDate: '2026-06-11',
    plannedStartTime: new Date(Date.now() - 3 * HOUR),
    plannedEndTime: new Date(Date.now() - 2 * HOUR),
    userIdRequired: 'u-teacher',
    courseOfferingId: null,
    courseLabel: null,
    subjectLabel: 'Matemática',
    ...overrides,
  }
}

function resolvedRow(overrides: Record<string, unknown> = {}) {
  return {
    planned: plannedInstance(),
    checkInStatusResolved: 'ABSENT_NOT_JUSTIFIED',
    checkOutStatusResolved: 'ABSENT_NOT_JUSTIFIED',
    hasCheckIn: false,
    hasCheckOut: false,
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 0,
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: 'Jorge Marrero',
    userRole: 'TEACHER',
    userEmail: 'jorge@example.com',
    ...overrides,
  }
}

function payload(params: Record<string, unknown>) {
  return { intent: 'ABSENCES_SUMMARY' as const, params, reply: '' }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveUserIdsFromSearch.mockResolvedValue(null)
})

describe('executeAbsencesSummary', () => {
  it('lista faltas derivadas (incluye las no materializadas) excluyendo ocurrencias futuras', async () => {
    const finished = plannedInstance()
    const future = plannedInstance({
      plannedInstanceId: 'ev1_2026-06-12',
      plannedDate: '2026-06-12',
      plannedStartTime: new Date(Date.now() + HOUR),
      plannedEndTime: new Date(Date.now() + 2 * HOUR),
    })
    mocks.getPlannedInstances.mockResolvedValue([finished, future])
    mocks.resolveAttendanceAndJustification.mockResolvedValue([resolvedRow({ planned: finished })])

    const r = await executeAbsencesSummary(payload({ month: 6, year: 2026 }), {
      schoolYearId: 'sy-1',
      schoolYearCode: 2026,
    })

    expect(mocks.getPlannedInstances).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-06-01', to: '2026-06-30', schoolYearId: 'sy-1' }),
    )
    // La ocurrencia futura no debe llegar a la resolución: todavía no es una falta.
    expect(mocks.resolveAttendanceAndJustification).toHaveBeenCalledWith({ plannedInstances: [finished] })
    expect(r.intent).toBe('ABSENCES_SUMMARY')
    expect(r.rows).toEqual([
      {
        persona: 'Jorge Marrero',
        rol: 'TEACHER',
        fecha: '11/06/2026',
        evento: 'Matemática 1A (Matemática)',
        horario: expect.stringMatching(/^\d{2}:\d{2}–\d{2}:\d{2}$/),
        estado: 'Ausente (no justificada)',
      },
    ])
  })

  it('excluye presentes y respeta personRoleScope', async () => {
    const inst = plannedInstance()
    mocks.getPlannedInstances.mockResolvedValue([inst])
    mocks.resolveAttendanceAndJustification.mockResolvedValue([
      resolvedRow({ planned: inst }),
      resolvedRow({ planned: inst, checkInStatusResolved: 'PRESENT', userDisplayName: 'Presente P' }),
      resolvedRow({ planned: inst, userRole: 'STAFF', userDisplayName: 'Staff S' }),
    ])

    const r = await executeAbsencesSummary(payload({ month: 6, year: 2026, personRoleScope: 'TEACHER' }))

    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]?.persona).toBe('Jorge Marrero')
  })

  it('COUNT_BY_USER agrupa y desglosa justificadas/no justificadas', async () => {
    const inst = plannedInstance()
    mocks.getPlannedInstances.mockResolvedValue([inst])
    mocks.resolveAttendanceAndJustification.mockResolvedValue([
      resolvedRow({ planned: inst }),
      resolvedRow({ planned: inst, checkInStatusResolved: 'ABSENT_JUSTIFIED' }),
      resolvedRow({
        planned: plannedInstance({ userIdRequired: 'u-2' }),
        userDisplayName: 'Otra Docente',
      }),
    ])

    const r = await executeAbsencesSummary(payload({ month: 6, year: 2026, incidentViewMode: 'COUNT_BY_USER' }))

    expect(r.rows).toEqual([
      { persona: 'Jorge Marrero', rol: 'TEACHER', faltas: 2, no_justificadas: 1, justificadas: 1 },
      { persona: 'Otra Docente', rol: 'TEACHER', faltas: 1, no_justificadas: 1, justificadas: 0 },
    ])
  })

  it('sin rango pide mes o fechas', async () => {
    const r = await executeAbsencesSummary(payload({}))
    expect(r.rows).toEqual([])
    expect(r.summary).toMatch(/mes|rango/i)
    expect(mocks.getPlannedInstances).not.toHaveBeenCalled()
  })
})
