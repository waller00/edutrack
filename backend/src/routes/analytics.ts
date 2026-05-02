import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { getPlannedInstances } from '../services/analytics/planInstances.js'
import { resolveAttendanceAndJustification } from '../services/analytics/resolveInstances.js'
import { computeDashboardKpis, computeSeriesByWeek } from '../services/analytics/metrics.js'
import { prisma } from '../prisma.js'

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

r.get('/dashboard', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const parsed = dashboardQuerySchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const { from, to, role, userId, eventType } = parsed.data
    const granularity = parsed.data.granularity || 'week'
    if (granularity !== 'week') {
      // Fase 1: se implementa week; las otras granularidades se soportan en el builder en Fase 2.
      // Para evitar ambigüedad, normalizamos a week.
    }

    const userIds = await scopeUserIds({ role, userId })
    const plannedInstances = await getPlannedInstances({ from, to, userId, userIds: userIds || undefined, eventType })
    const resolvedInstances = await resolveAttendanceAndJustification({ plannedInstances })
    const kpis = await computeDashboardKpis({ from, to, resolvedInstances })

    const seriesRaw = computeSeriesByWeek(resolvedInstances, from, to)
    const series = {
      lateRateByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.lateRate })),
      aopByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.aop })),
    }

    return res.json({
      kpis,
      series,
      topLists: { topRiskPeople: [], topRiskEvents: [] },
    })
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})

// Fase 1: endpoints con retorno vacío para mantener contrato en UI (se completan en Fase 2).
r.get('/metrics', authGuard, requireRole('ADMIN'), async (req, res) => {
  return res.json({ ok: true, message: 'metrics endpoint (Fase 2: expandir agregaciones)' })
})
r.get('/rankings', authGuard, requireRole('ADMIN'), async (_req, res) => {
  return res.json({ people: [], events: [] })
})
r.get('/alerts/critical', authGuard, requireRole('ADMIN'), async (_req, res) => {
  return res.json({ alerts: [] })
})
r.get('/anomalies', authGuard, requireRole('ADMIN'), async (_req, res) => {
  return res.json({ anomalies: [] })
})

export default r

