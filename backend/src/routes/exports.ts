import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { createPendingExport, getDownloadUrl, getExport, markDone, markFailed } from '../services/exports/exportStore.js'
import { getPlannedInstances } from '../services/analytics/planInstances.js'
import { resolveAttendanceAndJustification } from '../services/analytics/resolveInstances.js'
import { generateAttendanceDetailCsv, generateAttendanceDetailXlsx } from '../services/analytics/exports/attendanceDetailExport.js'
import {
  generateAttendanceDetailCsvFromAttendances,
  generateAttendanceDetailPdfFromAttendances,
  generateAttendanceDetailXlsxFromAttendances,
} from '../services/analytics/exports/attendanceDetailFromAttendancesExport.js'
import {
  generateAttendanceAssistanceReportPdfFromAttendances,
  generateAttendanceAssistanceReportXlsxFromAttendances,
} from '../services/analytics/exports/attendanceAssistanceReportExport.js'
import { generateMonthlySummaryPdf } from '../services/analytics/exports/monthlySummaryPdf.js'
import { prisma } from '../prisma.js'

const r = Router()

const exportBodySchema = z.object({
  reportKey: z.enum([
    'attendance_detail',
    'monthly_summary',
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
        .enum(['PRESENT', 'LATE', 'ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'EXIT', 'EARLY_EXIT'])
        .optional(),
    })
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    })
    .optional(),
})

r.post('/', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const parsed = exportBodySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const { reportKey, format, from, to, filters } = parsed.data

    const sanitizePart = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
    const shortUuid = (id: string) => (id.length > 10 ? id.slice(-8) : id)

    const filterSuffixParts: string[] = []
    const role = filters?.role
    const userId = filters?.userId
    const eventType = filters?.eventType
    const eventId = filters && 'eventId' in filters ? (filters as any).eventId : undefined
    const type = filters && 'type' in filters ? (filters as any).type : undefined
    const status = filters && 'status' in filters ? (filters as any).status : undefined

    if (role) filterSuffixParts.push(`role-${sanitizePart(role)}`)
    if (userId) filterSuffixParts.push(`user-${shortUuid(userId)}`)
    if (eventType) filterSuffixParts.push(`eventType-${sanitizePart(eventType)}`)
    if (eventId) filterSuffixParts.push(`event-${shortUuid(eventId)}`)
    if (type) filterSuffixParts.push(`type-${sanitizePart(type)}`)
    if (status) filterSuffixParts.push(`status-${sanitizePart(status)}`)

    const filterSuffix = filterSuffixParts.length ? `__${filterSuffixParts.join('__')}` : ''

    const exportFilenameBase = (() => {
      if (reportKey === 'attendance_detail') return `EduTrack_Asistencia_Detallada_${from}_${to}${filterSuffix}`
      if (reportKey === 'monthly_summary') return `EduTrack_Asistencia_Resumen_Mensual_${from.slice(0, 7)}${filterSuffix}`
      return `EduTrack_Export_${from}_${to}${filterSuffix}`
    })()

    const contentType =
      format === 'XLSX'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : format === 'CSV'
          ? 'text/csv; charset=utf-8'
          : 'application/pdf'

    const filename = `${exportFilenameBase}.${format === 'XLSX' ? 'xlsx' : format === 'CSV' ? 'csv' : 'pdf'}`
    const exportId = createPendingExport({ format, reportKey, filename, contentType })

    const scopeUserIds = async () => {
      if (!filters?.role && !filters?.userId) return null
      if (filters?.userId) return [filters.userId]
      const rows = await prisma.user.findMany({
        where: { orgRole: { code: filters.role } },
        select: { id: true },
      })
      return rows.map((r) => r.id)
    }

    const userIds = await scopeUserIds()

    if (reportKey === 'attendance_detail') {
      const attendanceFiltersForBackend = {
        from,
        to,
        role: filters?.role,
        userId: filters?.userId,
        eventId: filters?.eventId,
        eventType: filters?.eventType,
        type: filters?.type,
        status: filters?.status,
      }

      if (format === 'XLSX') {
        const buffer = await generateAttendanceAssistanceReportXlsxFromAttendances({ filters: attendanceFiltersForBackend })
        markDone(exportId, buffer)
      } else if (format === 'CSV') {
        const csv = await generateAttendanceDetailCsvFromAttendances({ filters: attendanceFiltersForBackend })
        markDone(exportId, Buffer.from(csv, 'utf-8'))
      } else if (format === 'PDF') {
        const buffer = await generateAttendanceAssistanceReportPdfFromAttendances({ filters: attendanceFiltersForBackend })
        markDone(exportId, buffer)
      } else {
        markFailed(exportId, 'Formato inválido para attendance_detail')
        return res.status(400).json({ message: 'Formato inválido para attendance_detail' })
      }
    }

    if (reportKey === 'monthly_summary') {
      if (format !== 'PDF') {
        markFailed(exportId, 'Format not allowed for monthly_summary')
        return res.status(400).json({ message: 'Formato inválido para monthly_summary' })
      }
      const plannedInstances = await getPlannedInstances({
        from,
        to,
        userId: filters?.userId,
        userIds: userIds || undefined,
        eventType: filters?.eventType,
      })
      const resolvedInstances = await resolveAttendanceAndJustification({ plannedInstances })
      const buffer = await generateMonthlySummaryPdf({
        resolvedInstances,
        from,
        to,
        filters: filters || {},
      })
      markDone(exportId, buffer)
    }

    return res.status(201).json({
      exportId,
      status: 'DONE',
      downloadUrl: getDownloadUrl(exportId),
    })
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})

r.get('/:exportId', authGuard, requireRole('ADMIN'), (req, res) => {
  const exportId = req.params.exportId
  const e = getExport(exportId)
  if (!e) return res.status(404).json({ message: 'Export no encontrada' })
  const downloadUrl = e.status === 'DONE' ? getDownloadUrl(exportId) : null
  res.json({ exportId: e.exportId, status: e.status, downloadUrl })
})

r.get('/:exportId/download', authGuard, requireRole('ADMIN'), (req, res) => {
  const exportId = req.params.exportId
  const e = getExport(exportId)
  if (!e) return res.status(404).json({ message: 'Export no encontrada' })
  if (e.status !== 'DONE' || !e.buffer) return res.status(409).json({ message: 'Export no lista aún' })
  res.setHeader('Content-Type', e.contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${e.filename}"`)
  res.send(e.buffer)
})

export default r

