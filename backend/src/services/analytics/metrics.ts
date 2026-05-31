import { prisma } from '../../db/prisma.js'
import type {
  DashboardKpis,
  DashboardTopRiskEvent,
  DashboardTopRiskPerson,
  ResolvedAttendanceByInstance,
} from './models.js'
import { toYmdUtc, parseYmdToUtcRange } from './dateRange.js'

const SLA_DAYS = 3

function pct(n: number, d: number) {
  if (!d) return 0
  return (n / d) * 100
}

function roundTo(n: number, decimals: number) {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

export function computeRangeKpis(resolvedInstances: ResolvedAttendanceByInstance[], opts: { plannedInstancesCount?: number }) {
  const totalPlan = opts.plannedInstancesCount ?? resolvedInstances.length
  if (totalPlan === 0) {
    return {
      M1_PUNCTUALITY_pct: 0,
      M2_LATE_RATE_pct: 0,
      M4_AOP_pct: 0,
      M6_COVERAGE_CP_pct: 0,
      M8_HOURS_DELTA_pct: 0,
    }
  }

  const checkInPresent = resolvedInstances.filter((i) => i.checkInStatusResolved === 'PRESENT' || i.checkInStatusResolved === 'LATE')
  const totalIn = checkInPresent.length
  const onTime = resolvedInstances.filter((i) => i.checkInStatusResolved === 'PRESENT').length
  const late = resolvedInstances.filter((i) => i.checkInStatusResolved === 'LATE').length

  const M1_PUNCTUALITY_pct = totalIn ? roundTo(pct(onTime, totalIn), 2) : 0
  const M2_LATE_RATE_pct = totalIn ? roundTo(pct(late, totalIn), 2) : 0

  const absent = resolvedInstances.filter(
    (i) =>
      i.checkInStatusResolved === 'ABSENT_NOT_JUSTIFIED' ||
      i.checkInStatusResolved === 'ABSENT_JUSTIFIED' ||
      i.checkInStatusResolved === 'SUBSTITUTED',
  ).length
  const M4_AOP_pct = roundTo(pct(absent, totalPlan), 2)

  const covered = resolvedInstances.filter((i) => {
    const inCovered = i.checkInStatusResolved === 'PRESENT' || i.checkInStatusResolved === 'LATE'
    const outCovered = i.checkOutStatusResolved === 'EXIT' || i.checkOutStatusResolved === 'EARLY_EXIT'
    return inCovered || outCovered
  }).length
  const M6_COVERAGE_CP_pct = roundTo(pct(covered, totalPlan), 2)

  // Horas reales vs plan: Delta% con denom planned_total.
  let plannedTotalMinutes = 0
  let actualTotalMinutes = 0
  for (const i of resolvedInstances) {
    actualTotalMinutes += i.durationMinutes
    if (i.planned.plannedStartTime && i.planned.plannedEndTime) {
      const plannedMs = i.planned.plannedEndTime.getTime() - i.planned.plannedStartTime.getTime()
      plannedTotalMinutes += plannedMs / (1000 * 60)
    }
  }
  const deltaMinutes = actualTotalMinutes - plannedTotalMinutes
  const M8_HOURS_DELTA_pct = plannedTotalMinutes > 0 ? roundTo((deltaMinutes / plannedTotalMinutes) * 100, 2) : 0

  return { M1_PUNCTUALITY_pct, M2_LATE_RATE_pct, M4_AOP_pct, M6_COVERAGE_CP_pct, M8_HOURS_DELTA_pct }
}

function weekStartUtc(ymd: string) {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  // Lunes=0 ... Domingo=6
  const day = d.getUTCDay()
  const offset = (day + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return toYmdUtc(d)
}

export function computeSeriesByWeek(resolvedInstances: ResolvedAttendanceByInstance[], from: string, to: string) {
  const fromWeek = weekStartUtc(from)
  const toWeek = weekStartUtc(to)
  const series: { period: string; lateRate: number; aop: number }[] = []

  let cursorYmd = fromWeek
  while (cursorYmd <= toWeek) {
    const start = cursorYmd
    const endDate = new Date(`${cursorYmd}T00:00:00.000Z`)
    endDate.setUTCDate(endDate.getUTCDate() + 6)
    const end = toYmdUtc(endDate)

    const chunk = resolvedInstances.filter((i) => i.planned.plannedDate >= start && i.planned.plannedDate <= end)
    const k = computeRangeKpis(chunk, { plannedInstancesCount: chunk.length })
    series.push({ period: start, lateRate: k.M2_LATE_RATE_pct, aop: k.M4_AOP_pct })

    endDate.setUTCDate(endDate.getUTCDate() + 1)
    cursorYmd = toYmdUtc(endDate)
  }
  return series
}

export async function computePCCount(params: { from: string; to: string }) {
  const { fromDate, toDate } = parseYmdToUtcRange(params.from, params.to)

  const inactiveCount = await prisma.medicalLeave.count({
    where: {
      status: 'INACTIVE',
      endDate: { gte: fromDate },
      // Solapan el rango consultado.
      startDate: { lte: toDate },
    } as any,
  })
  return inactiveCount
}

export async function computeDashboardKpis(params: {
  from: string
  to: string
  resolvedInstances: ResolvedAttendanceByInstance[]
}) {
  const kpis = computeRangeKpis(params.resolvedInstances, { plannedInstancesCount: params.resolvedInstances.length })
  const PC_count = await computePCCount({ from: params.from, to: params.to })
  const out: DashboardKpis = { ...kpis, PC_count }
  return out
}

const RISK_WEIGHT_LATE = 1
const RISK_WEIGHT_ABSENT_UNJUSTIFIED = 2

/**
 * Prioriza personas con más eventos tardíos y ausencias sin justificación (sin licencia).
 * `riskScore`: tarde ×1 + ausente no justificado ×2 por instancia.
 */
type PersonAggRow = Pick<
  DashboardTopRiskPerson,
  | 'userId'
  | 'displayName'
  | 'role'
  | 'plannedCount'
  | 'lateCount'
  | 'absentNotJustifiedCount'
  | 'absentJustifiedCount'
>

export function computeTopRiskPeople(
  resolved: ResolvedAttendanceByInstance[],
  opts: { limit?: number } = {},
): DashboardTopRiskPerson[] {
  const limit = opts.limit ?? 10
  const byUser = new Map<string, PersonAggRow>()

  for (const r of resolved) {
    const userId = r.planned.userIdRequired
    if (!userId) continue

    let row = byUser.get(userId)
    if (!row) {
      row = {
        userId,
        displayName: r.userDisplayName,
        role: r.userRole || '—',
        plannedCount: 0,
        lateCount: 0,
        absentNotJustifiedCount: 0,
        absentJustifiedCount: 0,
      }
      byUser.set(userId, row)
    }

    row.plannedCount += 1
    if (r.checkInStatusResolved === 'LATE') row.lateCount += 1
    if (r.checkInStatusResolved === 'ABSENT_NOT_JUSTIFIED') row.absentNotJustifiedCount += 1
    if (r.checkInStatusResolved === 'ABSENT_JUSTIFIED') row.absentJustifiedCount += 1
  }

  const out: DashboardTopRiskPerson[] = [...byUser.values()].map((row) => ({
    ...row,
    riskScore:
      row.lateCount * RISK_WEIGHT_LATE + row.absentNotJustifiedCount * RISK_WEIGHT_ABSENT_UNJUSTIFIED,
  }))

  out.sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore
    if (b.absentNotJustifiedCount !== a.absentNotJustifiedCount) return b.absentNotJustifiedCount - a.absentNotJustifiedCount
    return b.lateCount - a.lateCount
  })

  return out.slice(0, limit)
}

/**
 * Eventos con mayor fricción simultánea: tardanza sobre entradas registradas + ausentismo / instancias planificadas.
 */
export function computeTopRiskEvents(resolved: ResolvedAttendanceByInstance[], opts: { limit?: number } = {}): DashboardTopRiskEvent[] {
  const limit = opts.limit ?? 10
  const byEventId = new Map<string, ResolvedAttendanceByInstance[]>()
  for (const r of resolved) {
    const id = r.planned.eventId
    if (!byEventId.has(id)) byEventId.set(id, [])
    byEventId.get(id)!.push(r)
  }

  const rows: DashboardTopRiskEvent[] = []
  for (const [, arr] of byEventId) {
    const k = computeRangeKpis(arr, { plannedInstancesCount: arr.length })
    const sample = arr[0]!.planned
    rows.push({
      eventId: sample.eventId,
      title: sample.eventTitle || 'Sin título',
      eventType: sample.eventType,
      plannedCount: arr.length,
      lateRatePct: k.M2_LATE_RATE_pct,
      absentOverPlanPct: k.M4_AOP_pct,
      focusScore: roundTo(k.M2_LATE_RATE_pct + k.M4_AOP_pct, 2),
    })
  }

  rows.sort((a, b) => {
    if (b.focusScore !== a.focusScore) return b.focusScore - a.focusScore
    if (b.absentOverPlanPct !== a.absentOverPlanPct) return b.absentOverPlanPct - a.absentOverPlanPct
    return b.lateRatePct - a.lateRatePct
  })

  return rows.slice(0, limit)
}
