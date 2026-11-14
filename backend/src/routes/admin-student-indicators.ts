import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { userPermissionScope } from '../middlewares/auth.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { isReportCardPeriod } from '../services/gradebook/period-closure.js'
import { loadStudentIndicatorsReport } from '../services/student-indicators/report.js'
import type { IndicatorAccess, ReportPeriod } from '../services/student-indicators/report-sections.js'
import { REPORT_FORMATS, sendReport } from '../services/reports/send.js'

/**
 * Informe de "Indicadores de estudiantes" (PDF o Excel).
 *
 * Montado bajo `/admin/student-indicators` con `academic-analytics.read` o `student-reports.read`
 * de alcance ALL: lo descarga quien ve la pantalla, y trae sólo las secciones que esa persona ve
 * (Adscripción con sólo los reportes, sin Rendimiento ni Trayectoria). Cada descarga queda en la
 * auditoría, sin nombres.
 */
const r = Router()

const reportQuery = z.object({
  format: z.enum(REPORT_FORMATS),
  schoolYearId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
})

/** Lo que ve en la pantalla: cada sección pide su permiso con alcance `all`. */
async function accessOf(req: any): Promise<IndicatorAccess> {
  const user = req.user
  const userId = user?.id ?? user?.sub
  const [analytics, reports] = await Promise.all([
    userPermissionScope(userId, 'academic-analytics.read', user?.role),
    userPermissionScope(userId, 'student-reports.read', user?.role),
  ])
  return { analytics: analytics === 'all', reports: reports === 'all' }
}

/** El boletín de referencia: tiene que ser una reunión de boletín del ciclo del informe. */
async function reportPeriod(periodId: string | undefined, schoolYearId: string): Promise<ReportPeriod | null | 'mismatch'> {
  if (!periodId) return null
  const period = await prisma.academicPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, name: true, level: true, schoolYearId: true, isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true },
  })
  if (!period || period.schoolYearId !== schoolYearId || !isReportCardPeriod(period)) return 'mismatch'
  return { id: period.id, name: period.name, level: period.level ?? null }
}

r.get('/report', async (req: any, res) => {
  const parsed = reportQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  try {
    const { format, periodId } = parsed.data
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      // Montado con alcance `all`: quien llega ve todo el centro y elige el ciclo.
      institutionWide: true,
      requestedSchoolYearId: parsed.data.schoolYearId,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const period = await reportPeriod(periodId, schoolYearId)
    if (period === 'mismatch') return res.status(400).json({ message: 'Ese boletín no es de este ciclo lectivo.', code: 'PERIOD_MISMATCH' })

    const access = await accessOf(req)
    const report = await loadStudentIndicatorsReport({ schoolYearId, period, access, generatedAt: new Date() })
    return await sendReport(req, res, {
      report,
      format,
      audit: {
        kind: 'student-indicators-report',
        entityId: schoolYearId,
        details: { periodId: period?.id ?? null, sections: report.sections.map((section) => section.id) },
      },
    })
  } catch (error) {
    console.error('[student-indicators] report:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
