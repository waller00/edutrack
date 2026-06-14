import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { createPendingExport, getDownloadUrl, getExport, markDone, markFailed } from '../services/exports/exportStore.js'
import { getPlannedInstances } from '../services/analytics/planInstances.js'
import { resolveAttendanceAndJustification } from '../services/analytics/resolveInstances.js'
import {
  buildPayrollAttendanceData,
  generatePayrollAttendanceCsv,
  generatePayrollAttendancePdf,
  generatePayrollAttendanceXlsx,
} from '../services/analytics/exports/payrollAttendanceReport.js'
import { generateMonthlySummaryPdf } from '../services/analytics/exports/monthlySummaryPdf.js'
import {
  generateDimensionReportPdf,
  generateDimensionReportXlsx,
} from '../services/analytics/exports/dimensionReportExport.js'
import { scopeUserIdsFor, resolveScopedSchoolYearId } from '../services/analytics/exports/exportScope.js'

const r = Router()

const exportBodySchema = z.object({
  reportKey: z.enum([
    'attendance_detail',
    'monthly_summary',
    'person_report',
    'course_report',
  ]),
  format: z.enum(['PDF', 'XLSX', 'CSV']),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filters: z
    .object({
      role: z.enum(['ADMIN', 'STAFF', 'TEACHER']).optional(),
      userId: z.string().uuid().optional(),
      eventType: z.enum(['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA']).optional(),
      eventId: z.string().uuid().optional(),
      type: z.enum(['CHECK_IN', 'CHECK_OUT']).optional(),
      status: z
        .enum([
          'PRESENT',
          'LATE',
          'ABSENT_NOT_JUSTIFIED',
          'ABSENT_JUSTIFIED',
          'EXIT',
          'EARLY_EXIT',
          'JUSTIFIED',
          'FREE',
          'PENDING_REVIEW',
          'SUBSTITUTED',
          'SUSPENDED',
          'OUT_OF_SCHEDULE',
          'UNIDENTIFIED_PUNCH',
        ])
        .optional(),
      schoolYearId: z.string().uuid().optional(),
      /** Si es true / "1", el export incluye todos los ciclos (sin filtro por event.schoolYearId). */
      allYears: z.union([z.boolean(), z.literal('1'), z.literal('0')]).optional(),
    })
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    })
    .optional(),
})

type ExportBody = z.infer<typeof exportBodySchema>
type ExportFilters = NonNullable<ExportBody['filters']>
type ExportFormat = ExportBody['format']
type ReportKey = ExportBody['reportKey']
type ReportResult = { buffer: Buffer } | { error: string }

function isAllYearsExport(filters?: ExportFilters) {
  return filters?.allYears === true || filters?.allYears === '1'
}

function buildFilterSuffix(filters?: ExportFilters) {
  const sanitizePart = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  const shortUuid = (id: string) => (id.length > 10 ? id.slice(-8) : id)
  const parts: string[] = []
  if (filters?.role) parts.push(`role-${sanitizePart(filters.role)}`)
  if (filters?.userId) parts.push(`user-${shortUuid(filters.userId)}`)
  if (filters?.eventType) parts.push(`eventType-${sanitizePart(filters.eventType)}`)
  if (filters?.eventId) parts.push(`event-${shortUuid(filters.eventId)}`)
  if (filters?.type) parts.push(`type-${sanitizePart(filters.type)}`)
  if (filters?.status) parts.push(`status-${sanitizePart(filters.status)}`)
  return parts.length ? `__${parts.join('__')}` : ''
}

function buildFilenameBase(reportKey: ReportKey, from: string, to: string, filterSuffix: string) {
  switch (reportKey) {
    case 'attendance_detail':
      return `EduTrack_Asistencia_Detallada_${from}_${to}${filterSuffix}`
    case 'monthly_summary':
      return `EduTrack_Asistencia_Resumen_Mensual_${from.slice(0, 7)}${filterSuffix}`
    case 'person_report':
      return `EduTrack_Reporte_Por_Persona_${from}_${to}${filterSuffix}`
    case 'course_report':
      return `EduTrack_Reporte_Por_Curso_${from}_${to}${filterSuffix}`
    default:
      return `EduTrack_Exportacion_${from}_${to}${filterSuffix}`
  }
}

function contentTypeFor(format: ExportFormat) {
  if (format === 'XLSX') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (format === 'CSV') return 'text/csv; charset=utf-8'
  return 'application/pdf'
}

function extensionFor(format: ExportFormat) {
  if (format === 'XLSX') return 'xlsx'
  if (format === 'CSV') return 'csv'
  return 'pdf'
}

/** Camino de instancias planificadas conciliadas (compartido por resumen mensual y variantes por dimensión). */
async function resolveInstancesForExport(from: string, to: string, filters: ExportFilters | undefined, allYearsExport: boolean) {
  const userIds = await scopeUserIdsFor(filters)
  const schoolYearId = await resolveScopedSchoolYearId(filters, allYearsExport)
  const plannedInstances = await getPlannedInstances({
    from,
    to,
    userId: filters?.userId,
    userIds: userIds || undefined,
    eventType: filters?.eventType,
    schoolYearId,
  })
  return resolveAttendanceAndJustification({ plannedInstances })
}

async function buildAttendanceDetail(format: ExportFormat, from: string, to: string, filters: ExportFilters | undefined, allYearsExport: boolean): Promise<ReportResult> {
  const data = await buildPayrollAttendanceData({
    from,
    to,
    filters: {
      role: filters?.role,
      userId: filters?.userId,
      eventId: filters?.eventId,
      eventType: filters?.eventType,
      status: filters?.status,
      schoolYearId: typeof filters?.schoolYearId === 'string' ? filters.schoolYearId : undefined,
      allYears: allYearsExport,
    },
  })
  if (format === 'XLSX') return { buffer: await generatePayrollAttendanceXlsx(data) }
  if (format === 'CSV') return { buffer: Buffer.from(generatePayrollAttendanceCsv(data), 'utf-8') }
  return { buffer: await generatePayrollAttendancePdf(data) }
}

async function buildMonthlySummary(format: ExportFormat, from: string, to: string, filters: ExportFilters | undefined, allYearsExport: boolean): Promise<ReportResult> {
  if (format !== 'PDF') return { error: 'Formato inválido para el resumen mensual' }
  const resolvedInstances = await resolveInstancesForExport(from, to, filters, allYearsExport)
  return { buffer: await generateMonthlySummaryPdf({ resolvedInstances, from, to, filters: filters || {} }) }
}

async function buildDimensionReport(reportKey: ReportKey, format: ExportFormat, from: string, to: string, filters: ExportFilters | undefined, allYearsExport: boolean): Promise<ReportResult> {
  if (format === 'CSV') return { error: 'Formato inválido para este reporte (usá XLSX o PDF)' }
  const resolvedInstances = await resolveInstancesForExport(from, to, filters, allYearsExport)
  const dimension = reportKey === 'person_report' ? 'person' : 'course'
  const buffer =
    format === 'XLSX'
      ? await generateDimensionReportXlsx({ resolvedInstances, from, to, dimension })
      : await generateDimensionReportPdf({ resolvedInstances, from, to, dimension })
  return { buffer }
}

async function buildReport(reportKey: ReportKey, format: ExportFormat, from: string, to: string, filters: ExportFilters | undefined, allYearsExport: boolean): Promise<ReportResult> {
  if (reportKey === 'attendance_detail') return buildAttendanceDetail(format, from, to, filters, allYearsExport)
  if (reportKey === 'monthly_summary') return buildMonthlySummary(format, from, to, filters, allYearsExport)
  return buildDimensionReport(reportKey, format, from, to, filters, allYearsExport)
}

r.post('/', authGuard, requirePermission('exports.create', 'all'), async (req, res) => {
  try {
    const parsed = exportBodySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const { reportKey, format, from, to, filters } = parsed.data
    const allYearsExport = isAllYearsExport(filters)

    const filename = `${buildFilenameBase(reportKey, from, to, buildFilterSuffix(filters))}.${extensionFor(format)}`
    const exportId = createPendingExport({ format, reportKey, filename, contentType: contentTypeFor(format) })

    const result = await buildReport(reportKey, format, from, to, filters, allYearsExport)
    if ('error' in result) {
      markFailed(exportId, result.error)
      return res.status(400).json({ message: result.error })
    }

    markDone(exportId, result.buffer)
    return res.status(201).json({
      exportId,
      status: 'DONE',
      downloadUrl: getDownloadUrl(exportId),
    })
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})

r.get('/:exportId', authGuard, requirePermission('exports.create', 'all'), (req, res) => {
  const exportId = req.params.exportId
  const e = getExport(exportId)
  if (!e) return res.status(404).json({ message: 'Exportación no encontrada' })
  const downloadUrl = e.status === 'DONE' ? getDownloadUrl(exportId) : null
  res.json({ exportId: e.exportId, status: e.status, downloadUrl, errorMessage: e.errorMessage })
})

r.get('/:exportId/download', authGuard, requirePermission('exports.create', 'all'), (req, res) => {
  const exportId = req.params.exportId
  const e = getExport(exportId)
  if (!e) return res.status(404).json({ message: 'Exportación no encontrada' })
  if (e.status !== 'DONE' || !e.buffer) return res.status(409).json({ message: 'Exportación no lista aún' })
  res.setHeader('Content-Type', e.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${e.filename}"`)
  res.send(e.buffer)
})

export default r
