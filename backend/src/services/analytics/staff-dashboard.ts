import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { resolveSchoolYearIdForList } from '../school-year-service.js'
import { getPlannedInstances } from './planInstances.js'
import { resolveAttendanceAndJustification } from './resolveInstances.js'
import { resolveSubstituteInstances } from './resolveSubstituteInstances.js'
import {
  buildDashboardBreakdowns,
  computeDashboardKpis,
  computeKpiDeltas,
  computeRangeCounts,
  computeSeriesByGranularity,
  computeSeriesByWeek,
  computeStatusDistribution,
  computeTopRiskEvents,
  computeTopRiskPeople,
} from './metrics.js'
import type { DashboardKpis, RangeCounts, ResolvedAttendanceByInstance } from './models.js'
import { periodSignals } from './staff-signals.js'

/**
 * Indicadores del personal: el tablero de `/analytics/dashboard` y su informe salen de acá, con el
 * mismo cálculo. Antes los exportadores resolvían los registros por su cuenta y no contaban las
 * suplencias: el papel no decía lo mismo que la pantalla.
 */

export const STAFF_EVENT_TYPES = ['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA'] as const

export const staffDashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(['ADMIN', 'STAFF', 'TEACHER']).optional(),
  userId: z.string().uuid().optional(),
  eventType: z.enum(STAFF_EVENT_TYPES).optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
  compareToPrevious: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  schoolYearId: z.string().uuid().optional(),
  allYears: z.union([z.literal('1'), z.literal('true')]).optional(),
})

export type StaffDashboardQuery = z.infer<typeof staffDashboardQuerySchema>

async function scopeUserIds(params: { role?: 'ADMIN' | 'STAFF' | 'TEACHER'; userId?: string }) {
  if (params.userId) return [params.userId]
  if (!params.role) return null
  const rows = await prisma.user.findMany({
    where: { orgRole: { code: params.role } },
    select: { id: true },
  })
  return rows.map((x) => x.id)
}

type ResolveScope = {
  userId?: string
  userIds?: string[]
  eventType?: StaffDashboardQuery['eventType']
  schoolYearId?: string
}

async function resolveInstancesForRange(from: string, to: string, scope: ResolveScope): Promise<ResolvedAttendanceByInstance[]> {
  const plannedInstances = await getPlannedInstances({
    from,
    to,
    userId: scope.userId,
    userIds: scope.userIds,
    eventType: scope.eventType,
    schoolYearId: scope.schoolYearId,
  })
  const [titularInstances, substituteInstances] = await Promise.all([
    resolveAttendanceAndJustification({ plannedInstances }),
    resolveSubstituteInstances({
      from,
      to,
      userId: scope.userId,
      userIds: scope.userIds,
      eventType: scope.eventType,
      schoolYearId: scope.schoolYearId,
    }),
  ])
  return [...titularInstances, ...substituteInstances]
}

/** Rango previo de igual longitud, inmediatamente anterior a [from, to]. */
export function previousRangeOf(from: string, to: string) {
  const fromD = new Date(`${from}T00:00:00.000Z`)
  const toD = new Date(`${to}T00:00:00.000Z`)
  const days = Math.round((toD.getTime() - fromD.getTime()) / 86_400_000) + 1
  const prevTo = new Date(fromD)
  prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1))
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { previousFrom: fmt(prevFrom), previousTo: fmt(prevTo) }
}

type Comparison = {
  previousFrom: string
  previousTo: string
  current: DashboardKpis
  previous: DashboardKpis
  deltas: DashboardKpis
  previousCounts: RangeCounts
}

async function compareWithPrevious(from: string, to: string, scope: ResolveScope, kpis: DashboardKpis): Promise<Comparison | null> {
  const { previousFrom, previousTo } = previousRangeOf(from, to)
  // El rango anterior cae casi siempre en otro ciclo (marzo–octubre se compara con julio–febrero):
  // acotado al ciclo elegido quedaba sin clases y la variación salía contra cero (+88,93 p.p.).
  const prevResolved = await resolveInstancesForRange(previousFrom, previousTo, { ...scope, schoolYearId: undefined })
  // Sin clases en el período anterior no hay contra qué comparar: no se muestra variación.
  if (prevResolved.length === 0) return null
  const prevKpis = await computeDashboardKpis({ from: previousFrom, to: previousTo, resolvedInstances: prevResolved })
  return {
    previousFrom,
    previousTo,
    current: kpis,
    previous: prevKpis,
    deltas: computeKpiDeltas(kpis, prevKpis),
    previousCounts: computeRangeCounts(prevResolved),
  }
}

/** El ciclo del filtro: el pedido o el activo; con "todos los ciclos", ninguno. */
async function schoolYearScope(data: StaffDashboardQuery): Promise<string | undefined> {
  if (data.allYears) return undefined
  const id = await resolveSchoolYearIdForList(prisma, { role: 'ADMIN', requestedSchoolYearId: data.schoolYearId })
  return id || undefined
}

/**
 * El tablero y los registros de los que sale. El informe usa además los registros para listar a
 * todas las personas (la pantalla sólo muestra las 10 para revisar).
 */
export async function loadStaffIndicators(data: StaffDashboardQuery) {
  const { from, to, role, userId, eventType } = data
  const granularity = data.granularity || 'week'
  const compareToPrevious = data.compareToPrevious !== '0' && data.compareToPrevious !== 'false'

  const userIds = await scopeUserIds({ role, userId })
  const schoolYearId = await schoolYearScope(data)
  const scope: ResolveScope = { userId, userIds: userIds || undefined, eventType, schoolYearId }

  const resolvedInstances = await resolveInstancesForRange(from, to, scope)
  const kpis = await computeDashboardKpis({ from, to, resolvedInstances })
  const counts = computeRangeCounts(resolvedInstances)

  // Serie legacy (semanal) para no romper consumidores existentes.
  const seriesRaw = computeSeriesByWeek(resolvedInstances, from, to)
  const series = {
    lateRateByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.lateRate })),
    aopByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.aop })),
  }
  const topRiskPeople = computeTopRiskPeople(resolvedInstances, { limit: 10 })
  const topRiskEvents = computeTopRiskEvents(resolvedInstances, { limit: 10 })
  const comparison = compareToPrevious ? await compareWithPrevious(from, to, scope, kpis) : null

  const body = {
    meta: {
      resolvedInstanceCount: resolvedInstances.length,
      rangeFrom: data.from,
      rangeTo: data.to,
      roleFilter: role ?? null,
      eventTypeFilter: eventType ?? null,
      schoolYearId: schoolYearId ?? null,
      allYears: Boolean(data.allYears),
      granularity,
      generatedAt: new Date().toISOString(),
    },
    kpis,
    counts,
    series,
    seriesMulti: computeSeriesByGranularity(resolvedInstances, from, to, granularity),
    breakdowns: buildDashboardBreakdowns(resolvedInstances),
    statusDistribution: computeStatusDistribution(resolvedInstances),
    comparison,
    topLists: { topRiskPeople, topRiskEvents },
    signals: periodSignals({ kpis, counts, people: topRiskPeople, events: topRiskEvents }),
  }
  return { body, resolvedInstances }
}

export type StaffDashboardBody = Awaited<ReturnType<typeof loadStaffIndicators>>['body']
