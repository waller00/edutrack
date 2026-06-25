import { describe, expect, it } from 'vitest'
import type { PlannedInstance, ResolvedAttendanceByInstance } from './models.js'
import { computeTopRiskEvents, computeTopRiskPeople } from './metrics.js'

function planned(overrides: Partial<PlannedInstance> & Pick<PlannedInstance, 'plannedInstanceId' | 'eventId' | 'plannedDate'>): PlannedInstance {
  return {
    eventTitle: 'Evento base',
    eventType: 'CLASE',
    eventStatus: 'ACTIVE',
    isRecurringInstance: false,
    plannedStartTime: null,
    plannedEndTime: null,
    userIdRequired: 'user-a',
    ...overrides,
  }
}

function resolved(
  overrides: Partial<ResolvedAttendanceByInstance> & { planned: PlannedInstance },
): ResolvedAttendanceByInstance {
  return {
    checkInStatusResolved: 'PRESENT',
    checkOutStatusResolved: 'EXIT',
    hasCheckIn: true,
    hasCheckOut: true,
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 0,
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: 'Usuario A',
    userRole: 'TEACHER',
    userEmail: 'a@edu.test',
    ...overrides,
  }
}

describe('computeTopRiskPeople', () => {
  it('prioriza tardanzas y ausencias sin justificación con mayor peso en ausentes', () => {
    const px = planned({ plannedInstanceId: 'ev1_2026-05-01', eventId: 'ev1', plannedDate: '2026-05-01', userIdRequired: 'u1' })
    const rows: ResolvedAttendanceByInstance[] = [
      resolved({
        planned: { ...px, plannedInstanceId: 'ev1_a', userIdRequired: 'u1' },
        userDisplayName: 'Uno',
        checkInStatusResolved: 'LATE',
      }),
      resolved({
        planned: { ...px, plannedInstanceId: 'ev1_b', userIdRequired: 'u2' },
        userDisplayName: 'Dos',
        checkInStatusResolved: 'ABSENT_NOT_JUSTIFIED',
      }),
    ]

    const top = computeTopRiskPeople(rows, { limit: 5 })
    expect(top[0]!.userId).toBe('u2')
    expect(top[0]!.riskScore).toBe(2)
    expect(top[1]!.userId).toBe('u1')
    expect(top[1]!.riskScore).toBe(1)
  })

  it('cuenta el SUBSTITUTED del titular como ausencia (justificada/no según licencia)', () => {
    const base = planned({ plannedInstanceId: 'x', eventId: 'ev', plannedDate: '2026-05-01' })
    const rows: ResolvedAttendanceByInstance[] = [
      resolved({
        planned: { ...base, plannedInstanceId: 'sin-lic', userIdRequired: 'robert' },
        userDisplayName: 'Robert',
        checkInStatusResolved: 'SUBSTITUTED',
        isJustifiedAbsence: false,
      }),
      resolved({
        planned: { ...base, plannedInstanceId: 'con-lic', userIdRequired: 'gabriela' },
        userDisplayName: 'Gabriela',
        checkInStatusResolved: 'SUBSTITUTED',
        isJustifiedAbsence: true,
      }),
    ]
    const top = computeTopRiskPeople(rows)
    const robert = top.find((p) => p.userId === 'robert')!
    const gabriela = top.find((p) => p.userId === 'gabriela')!
    expect(robert.absentNotJustifiedCount).toBe(1)
    expect(robert.riskScore).toBe(2)
    expect(gabriela.absentJustifiedCount).toBe(1)
    expect(gabriela.absentNotJustifiedCount).toBe(0)
    expect(gabriela.riskScore).toBe(0)
  })

  it('orden estable por segundo criterio (ausentes no justificados)', () => {
    const base = planned({ plannedInstanceId: 'x', eventId: 'ev', plannedDate: '2026-05-01' })
    const rows: ResolvedAttendanceByInstance[] = [
      resolved({
        planned: { ...base, plannedInstanceId: 'a1', userIdRequired: 'a' },
        userDisplayName: 'A',
        checkInStatusResolved: 'LATE',
      }),
      resolved({
        planned: { ...base, plannedInstanceId: 'a2', userIdRequired: 'a' },
        userDisplayName: 'A',
        checkInStatusResolved: 'LATE',
      }),
      resolved({
        planned: { ...base, plannedInstanceId: 'b1', userIdRequired: 'b' },
        userDisplayName: 'B',
        checkInStatusResolved: 'ABSENT_NOT_JUSTIFIED',
      }),
      resolved({
        planned: { ...base, plannedInstanceId: 'b2', userIdRequired: 'b' },
        userDisplayName: 'B',
        checkInStatusResolved: 'LATE',
      }),
    ]
    const top = computeTopRiskPeople(rows)
    expect(top[0]!.userId).toBe('b')
    expect(top[0]!.riskScore).toBe(3)
  })
})

describe('computeTopRiskEvents', () => {
  it('ordena por focusScore combinando tardanza y ausentismo', () => {
    const u = 'staff-1'
    const evBad = planned({
      plannedInstanceId: `bad_${u}_1`,
      eventId: 'event-bad',
      eventTitle: 'Peor slot',
      plannedDate: '2026-05-02',
      userIdRequired: u,
    })
    const evOk = planned({
      plannedInstanceId: `ok_${u}_1`,
      eventId: 'event-ok',
      eventTitle: 'Buen slot',
      plannedDate: '2026-05-02',
      userIdRequired: u,
    })

    const rows: ResolvedAttendanceByInstance[] = [
      resolved({ planned: evBad, checkInStatusResolved: 'ABSENT_NOT_JUSTIFIED' }),
      resolved({ planned: { ...evOk, plannedInstanceId: `ok_${u}_2` }, checkInStatusResolved: 'PRESENT' }),
    ]

    const top = computeTopRiskEvents(rows, { limit: 5 })
    expect(top[0]!.eventId).toBe('event-bad')
    expect(top[0]!.absentOverPlanPct).toBeGreaterThan(top[1]!.absentOverPlanPct)
  })
})
