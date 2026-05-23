import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { getPlannedInstances } from '../services/analytics/planInstances.js'
import { resolveAttendanceAndJustification } from '../services/analytics/resolveInstances.js'
import {
  computeDashboardKpis,
  computeSeriesByWeek,
  computeTopRiskEvents,
  computeTopRiskPeople,
} from '../services/analytics/metrics.js'
import { prisma } from '../db/prisma.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'

const r = Router()

const dashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(['ADMIN', 'STAFF', 'TEACHER']).optional(),
  userId: z.string().uuid().optional(),
  eventType: z
    .enum(['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA'])
    .optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
  schoolYearId: z.string().uuid().optional(),
  allYears: z.union([z.literal('1'), z.literal('true')]).optional(),
})

async function scopeUserIds(params: { role?: 'ADMIN' | 'STAFF' | 'TEACHER'; userId?: string }) {
  if (params.userId) return [params.userId]
  if (!params.role) return null
  const rows = await prisma.user.findMany({
    where: { orgRole: { code: params.role } },
    select: { id: true },
  })
  return rows.map((x) => x.id)
}

type ParsedDashboardQuery = z.infer<typeof dashboardQuerySchema>

async function computeAdminAnalyticsBody(data: ParsedDashboardQuery) {
  const { from, to, role, userId, eventType } = data
  const granularity = data.granularity || 'week'
  if (granularity !== 'week') {
    // Fase 1: se implementa week; las otras granularidades se soportan en el builder en Fase 2.
  }

  const userIds = await scopeUserIds({ role, userId })
  const schoolYearId = data.allYears
    ? undefined
    : await resolveSchoolYearIdForList(prisma, {
        role: 'ADMIN',
        requestedSchoolYearId: data.schoolYearId,
      })
  const plannedInstances = await getPlannedInstances({
    from,
    to,
    userId,
    userIds: userIds || undefined,
    eventType,
    schoolYearId: schoolYearId || undefined,
  })
  const resolvedInstances = await resolveAttendanceAndJustification({ plannedInstances })
  const kpis = await computeDashboardKpis({ from, to, resolvedInstances })

  const seriesRaw = computeSeriesByWeek(resolvedInstances, from, to)
  const series = {
    lateRateByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.lateRate })),
    aopByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.aop })),
  }

  const topRiskPeople = computeTopRiskPeople(resolvedInstances, { limit: 10 })
  const topRiskEvents = computeTopRiskEvents(resolvedInstances, { limit: 10 })

  return {
    meta: {
      resolvedInstanceCount: resolvedInstances.length,
      rangeFrom: data.from,
      rangeTo: data.to,
      roleFilter: role ?? null,
      eventTypeFilter: eventType ?? null,
      schoolYearId: schoolYearId ?? null,
      allYears: Boolean(data.allYears),
      generatedAt: new Date().toISOString(),
    },
    kpis,
    series,
    topLists: { topRiskPeople, topRiskEvents },
  }
}

r.get('/dashboard', authGuard, requirePermission('analytics.read', 'all'), async (req, res) => {
  try {
    const parsed = dashboardQuerySchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const body = await computeAdminAnalyticsBody(parsed.data)

    return res.json(body)
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})

// Fase 1: endpoints con retorno vacío para mantener contrato en UI (se completan en Fase 2).
r.get('/metrics', authGuard, requirePermission('analytics.read', 'all'), async (req, res) => {
  return res.json({ ok: true, message: 'metrics endpoint (Fase 2: expandir agregaciones)' })
})
r.get('/rankings', authGuard, requirePermission('analytics.read', 'all'), async (req, res) => {
  try {
    const parsed = dashboardQuerySchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const { topLists } = await computeAdminAnalyticsBody(parsed.data)
    return res.json({ people: topLists.topRiskPeople, events: topLists.topRiskEvents })
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})
r.get('/alerts/critical', authGuard, requirePermission('analytics.read', 'all'), async (_req, res) => {
  return res.json({ alerts: [] })
})
r.get('/anomalies', authGuard, requirePermission('analytics.read', 'all'), async (_req, res) => {
  return res.json({ anomalies: [] })
})

export default r
