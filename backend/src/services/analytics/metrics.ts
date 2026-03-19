import { prisma } from '../../prisma.js'
import type { DashboardKpis, PlannedInstance, ResolvedAttendanceByInstance } from './models.js'
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
    (i) => i.checkInStatusResolved === 'ABSENT_NOT_JUSTIFIED' || i.checkInStatusResolved === 'ABSENT_JUSTIFIED',
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
  const now = toDate
  const threshold = new Date(now.getTime() - SLA_DAYS * 24 * 60 * 60 * 1000)

  const pcCount = await prisma.medicalLeave.count({
    where: {
      status: 'PENDING',
      // No expiran antes del periodo.
      endDate: { gte: now },
      createdAt: { lte: threshold },
      // Solapan el rango consultado.
      startDate: { lte: toDate },
    } as any,
  })
  return pcCount
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

