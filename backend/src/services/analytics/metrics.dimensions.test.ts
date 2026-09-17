import { describe, expect, it } from 'vitest'
import type { PlannedInstance, ResolvedAttendanceByInstance, AttendanceStatusResolved } from './models.js'
import {
  buildDashboardBreakdowns,
  computeBreakdown,
  computeKpiDeltas,
  computeRangeKpis,
  computeSeriesByGranularity,
  computeStatusDistribution,
} from './metrics.js'

function planned(overrides: Partial<PlannedInstance> & Pick<PlannedInstance, 'plannedInstanceId' | 'eventId' | 'plannedDate'>): PlannedInstance {
  return {
    eventTitle: 'Evento base',
    eventType: 'CLASE',
    eventStatus: 'ACTIVE',
    isRecurringInstance: false,
    plannedStartTime: null,
    plannedEndTime: null,
    userIdRequired: 'user-a',
    courseOfferingId: null,
    courseLabel: null,
    subjectLabel: null,
    ...overrides,
  }
}

function resolved(
  status: AttendanceStatusResolved,
  p: Partial<PlannedInstance> & Pick<PlannedInstance, 'plannedInstanceId' | 'eventId' | 'plannedDate'>,
  extra: Partial<ResolvedAttendanceByInstance> = {},
): ResolvedAttendanceByInstance {
  return {
    planned: planned(p),
    checkInStatusResolved: status,
    checkOutStatusResolved: 'EXIT',
    hasCheckIn: true,
    hasCheckOut: false,
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 0,
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: 'Usuario',
    userRole: 'TEACHER',
    userEmail: 'u@edu.test',
    ...extra,
  }
}

describe('computeStatusDistribution', () => {
  it('cuenta estados y calcula porcentaje sobre el total planificado', () => {
    const rows = [
      resolved('PRESENT', { plannedInstanceId: 'a', eventId: 'e1', plannedDate: '2026-05-01' }),
      resolved('PRESENT', { plannedInstanceId: 'b', eventId: 'e1', plannedDate: '2026-05-02' }),
      resolved('LATE', { plannedInstanceId: 'c', eventId: 'e1', plannedDate: '2026-05-03' }),
      resolved('ABSENT_NOT_JUSTIFIED', { plannedInstanceId: 'd', eventId: 'e1', plannedDate: '2026-05-04' }),
    ]
    const dist = computeStatusDistribution(rows)
    expect(dist.totalPlanned).toBe(4)
    const present = dist.rows.find((r) => r.status === 'PRESENT')
    expect(present?.count).toBe(2)
    expect(present?.pct).toBe(50)
    expect(dist.rows.find((r) => r.status === 'LATE')?.pct).toBe(25)
    // No incluye estados con cero ocurrencias.
    expect(dist.rows.some((r) => r.status === 'SUBSTITUTED')).toBe(false)
  })

  it('devuelve total 0 sin filas cuando no hay instancias', () => {
    const dist = computeStatusDistribution([])
    expect(dist.totalPlanned).toBe(0)
    expect(dist.rows).toHaveLength(0)
  })

  it('mapea SUBSTITUTED (suplido) a ausencia justificada/no según la licencia, nunca como categoría propia', () => {
    const rows = [
      resolved('SUBSTITUTED', { plannedInstanceId: 's1', eventId: 'e1', plannedDate: '2026-05-05' }),
      resolved('SUBSTITUTED', { plannedInstanceId: 's2', eventId: 'e1', plannedDate: '2026-05-06' }, { isJustifiedAbsence: true }),
    ]
    const dist = computeStatusDistribution(rows)
    expect(dist.rows.some((r) => r.status === 'SUBSTITUTED')).toBe(false)
    expect(dist.rows.find((r) => r.status === 'ABSENT_NOT_JUSTIFIED')?.count).toBe(1)
    expect(dist.rows.find((r) => r.status === 'ABSENT_JUSTIFIED')?.count).toBe(1)
  })
})

describe('computeRangeKpis', () => {
  it('no cuenta una salida aislada como cobertura si la entrada está resuelta como ausencia', () => {
    const rows = [
      resolved(
        'ABSENT_NOT_JUSTIFIED',
        { plannedInstanceId: 'a', eventId: 'e1', plannedDate: '2026-05-01' },
        { checkOutStatusResolved: 'EXIT', hasCheckIn: false, hasCheckOut: true },
      ),
    ]

    const kpis = computeRangeKpis(rows, { plannedInstancesCount: rows.length })
    expect(kpis.M4_AOP_pct).toBe(100)
    expect(kpis.M6_COVERAGE_CP_pct).toBe(0)
  })

  it('cuenta la suplencia como ausencia del titular y NO como bloque cubierto', () => {
    // SUBSTITUTED es la ausencia del titular: aporta ausentismo pero no cobertura. La cobertura
    // real proviene de la instancia propia del suplente (presente) cuando efectivamente asiste.
    const rows = [
      resolved(
        'SUBSTITUTED',
        { plannedInstanceId: 's1', eventId: 'e1', plannedDate: '2026-05-01' },
        { hasCheckIn: false, hasCheckOut: false },
      ),
    ]

    const kpis = computeRangeKpis(rows, { plannedInstancesCount: rows.length })
    expect(kpis.M4_AOP_pct).toBe(100)
    expect(kpis.M6_COVERAGE_CP_pct).toBe(0)
  })
})

describe('computeBreakdown', () => {
  it('agrupa por dimensión, calcula tasas y ordena por volumen', () => {
    const rows = [
      resolved('LATE', { plannedInstanceId: 'a', eventId: 'e1', plannedDate: '2026-05-01' }, { userRole: 'TEACHER' }),
      resolved('PRESENT', { plannedInstanceId: 'b', eventId: 'e1', plannedDate: '2026-05-02' }, { userRole: 'TEACHER' }),
      resolved('PRESENT', { plannedInstanceId: 'c', eventId: 'e1', plannedDate: '2026-05-03' }, { userRole: 'STAFF' }),
    ]
    const out = computeBreakdown(rows, (r) => r.userRole || null, (r) => r.userRole)
    expect(out).toHaveLength(2)
    expect(out[0]!.key).toBe('TEACHER')
    expect(out[0]!.plannedCount).toBe(2)
    // 1 LATE sobre 2 entradas registradas → 50%
    expect(out[0]!.lateRatePct).toBe(50)
    expect(out[0]!.punctualityPct).toBe(50)
  })

  it('omite instancias cuya clave es nula', () => {
    const rows = [
      resolved('PRESENT', { plannedInstanceId: 'a', eventId: 'e1', plannedDate: '2026-05-01', courseOfferingId: null }),
    ]
    const out = computeBreakdown(rows, (r) => r.planned.courseOfferingId, (r) => r.planned.courseLabel ?? 'x')
    expect(out).toHaveLength(0)
  })
})

describe('buildDashboardBreakdowns', () => {
  it('arma los tres desgloses con etiquetas legibles', () => {
    const rows = [
      resolved('PRESENT', {
        plannedInstanceId: 'a',
        eventId: 'e1',
        plannedDate: '2026-05-01',
        eventType: 'CLASE',
        courseOfferingId: 'off-1',
        courseLabel: '1ºA',
      }),
      resolved('LATE', {
        plannedInstanceId: 'b',
        eventId: 'e2',
        plannedDate: '2026-05-02',
        eventType: 'REUNION',
        courseOfferingId: 'off-1',
        courseLabel: '1ºA',
      }),
    ]
    const bd = buildDashboardBreakdowns(rows)
    expect(bd.byRole[0]!.label).toBe('Docentes')
    expect(bd.byEventType.map((r) => r.label).sort()).toEqual(['Clase', 'Reunión'])
    expect(bd.byCourse).toHaveLength(1)
    expect(bd.byCourse[0]!.label).toBe('1ºA')
    expect(bd.byCourse[0]!.plannedCount).toBe(2)
  })
})

describe('computeSeriesByGranularity', () => {
  const base = [
    resolved('LATE', { plannedInstanceId: 'a', eventId: 'e1', plannedDate: '2026-05-01' }),
    resolved('PRESENT', { plannedInstanceId: 'b', eventId: 'e1', plannedDate: '2026-05-03' }),
    resolved('PRESENT', { plannedInstanceId: 'c', eventId: 'e1', plannedDate: '2026-06-10' }),
  ]

  it('agrupa por día generando un bucket por jornada del rango', () => {
    const series = computeSeriesByGranularity(base, '2026-05-01', '2026-05-03', 'day')
    expect(series.map((s) => s.period)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
    expect(series[0]!.lateRate).toBe(100)
    expect(series[2]!.lateRate).toBe(0)
  })

  it('agrupa por mes', () => {
    const series = computeSeriesByGranularity(base, '2026-05-01', '2026-06-15', 'month')
    expect(series.map((s) => s.period)).toEqual(['2026-05-01', '2026-06-01'])
  })

  it('agrupa por semana (lunes como inicio)', () => {
    const series = computeSeriesByGranularity(base, '2026-05-01', '2026-05-03', 'week')
    expect(series).toHaveLength(1)
    expect(series[0]!.period).toBe('2026-04-27')
  })
})

describe('computeKpiDeltas', () => {
  it('resta KPI a KPI entre actual y anterior', () => {
    const current = { M1_PUNCTUALITY_pct: 90, M2_LATE_RATE_pct: 10, M4_AOP_pct: 5, M6_COVERAGE_CP_pct: 80, M8_HOURS_DELTA_pct: 2, PC_count: 3 }
    const previous = { M1_PUNCTUALITY_pct: 80, M2_LATE_RATE_pct: 15, M4_AOP_pct: 8, M6_COVERAGE_CP_pct: 70, M8_HOURS_DELTA_pct: 1, PC_count: 1 }
    const deltas = computeKpiDeltas(current, previous)
    expect(deltas.M1_PUNCTUALITY_pct).toBe(10)
    expect(deltas.M2_LATE_RATE_pct).toBe(-5)
    expect(deltas.PC_count).toBe(2)
  })
})
