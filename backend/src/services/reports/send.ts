import type { Request, Response } from 'express'
import { recordDataExport } from '../audit-log.js'
import { attachmentDisposition } from '../exports/content-disposition.js'
import { loadInstitutionBranding } from '../institution-branding.js'
import type { ReportDoc } from './model.js'
import { renderReportPdf } from './render-pdf.js'
import { renderReportXlsx } from './render-xlsx.js'

export const REPORT_FORMATS = ['pdf', 'xlsx'] as const
export type ReportFormat = (typeof REPORT_FORMATS)[number]

const CONTENT_TYPES: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export type ReportAudit = {
  /** Qué informe es (`staff-indicators-report`, `student-indicators-report`). */
  kind: string
  entityId?: string | null
  /** Sólo ids, fechas y opciones: nunca nombres ni lo que trae el informe. */
  details?: Record<string, unknown>
}

/**
 * Dibuja el informe en el formato pedido, deja la descarga en la auditoría (`DATA_EXPORTED`) y lo
 * manda como adjunto. Es el único camino de salida de los informes de indicadores.
 */
export async function sendReport(req: Request, res: Response, params: { report: ReportDoc; format: ReportFormat; audit: ReportAudit }) {
  const institution = await loadInstitutionBranding()
  const { report, format, audit } = params
  const buffer = format === 'pdf' ? await renderReportPdf(report, institution) : await renderReportXlsx(report, institution)
  recordDataExport(req, { kind: audit.kind, format, entityId: audit.entityId ?? null, details: audit.details })
  res.setHeader('Content-Type', CONTENT_TYPES[format])
  res.setHeader('Content-Disposition', attachmentDisposition(`${report.filename}.${format}`))
  return res.send(buffer)
}
