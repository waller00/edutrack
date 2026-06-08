import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { buildDashboardBreakdowns, computeBreakdown, computeStatusDistribution } from '../metrics.js'
import type { DashboardBreakdownRow, ResolvedAttendanceByInstance, StatusDistribution } from '../models.js'

export type DimensionReport = 'person' | 'course'

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Presente',
  LATE: 'Tarde',
  ABSENT_NOT_JUSTIFIED: 'Ausente no justificado',
  ABSENT_JUSTIFIED: 'Ausente justificado',
  SUBSTITUTED: 'Suplido',
}

function fmtPct(n: number) {
  return `${n.toFixed(2)}%`
}

/** Filas del desglose primario según la dimensión solicitada. */
function primaryRows(resolved: ResolvedAttendanceByInstance[], dimension: DimensionReport): DashboardBreakdownRow[] {
  if (dimension === 'person') {
    return computeBreakdown(
      resolved,
      (r) => r.planned.userIdRequired,
      (r) => r.userDisplayName || 'Sin nombre',
    )
  }
  return computeBreakdown(
    resolved,
    (r) => r.planned.courseOfferingId,
    (r) => r.planned.courseLabel ?? 'Curso sin nombre',
  )
}

function reportTitle(dimension: DimensionReport) {
  return dimension === 'person' ? 'Reporte de asistencia por persona' : 'Reporte de asistencia por curso'
}

function primaryColumnHeader(dimension: DimensionReport) {
  return dimension === 'person' ? 'Persona' : 'Curso / Asignatura'
}

type DimensionReportInput = {
  resolvedInstances: ResolvedAttendanceByInstance[]
  from: string
  to: string
  dimension: DimensionReport
}

export async function generateDimensionReportXlsx(params: DimensionReportInput): Promise<Buffer> {
  const rows = primaryRows(params.resolvedInstances, params.dimension)
  const distribution = computeStatusDistribution(params.resolvedInstances)
  const breakdowns = buildDashboardBreakdowns(params.resolvedInstances)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EduTrack'

  const summary = workbook.addWorksheet('Resumen')
  summary.addRow([reportTitle(params.dimension)])
  summary.addRow([`Período: ${params.from} a ${params.to}`])
  summary.addRow([`Generado: ${new Date().toISOString()}`])
  summary.addRow([`Instancias planificadas: ${params.resolvedInstances.length}`])

  const detail = workbook.addWorksheet('Desglose')
  detail.addRow([primaryColumnHeader(params.dimension), 'Planificadas', 'Puntualidad %', 'Tarde %', 'Ausentismo %', 'Cobertura %'])
  for (const row of rows) {
    detail.addRow([row.label, row.plannedCount, row.punctualityPct, row.lateRatePct, row.aopPct, row.coveragePct])
  }

  const statusSheet = workbook.addWorksheet('Estados')
  statusSheet.addRow(['Estado', 'Cantidad', '% del plan'])
  for (const s of distribution.rows) {
    statusSheet.addRow([STATUS_LABELS[s.status] ?? s.status, s.count, s.pct])
  }

  // Desgloses transversales (rol y tipo de evento) para contexto.
  const crossSheet = workbook.addWorksheet('Desgloses')
  crossSheet.addRow(['Por rol'])
  crossSheet.addRow(['Rol', 'Planificadas', 'Tarde %', 'Ausentismo %'])
  for (const row of breakdowns.byRole) {
    crossSheet.addRow([row.label, row.plannedCount, row.lateRatePct, row.aopPct])
  }
  crossSheet.addRow([])
  crossSheet.addRow(['Por tipo de evento'])
  crossSheet.addRow(['Tipo', 'Planificadas', 'Tarde %', 'Ausentismo %'])
  for (const row of breakdowns.byEventType) {
    crossSheet.addRow([row.label, row.plannedCount, row.lateRatePct, row.aopPct])
  }

  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out)
}

function renderStatusDistributionPdf(doc: PDFKit.PDFDocument, distribution: StatusDistribution, startX: number) {
  doc.moveDown(1)
  doc.fontSize(13).font('Helvetica-Bold').text('Distribución de estados')
  doc.moveDown(0.3)
  doc.fontSize(9).font('Helvetica')
  for (const s of distribution.rows) {
    doc.text(`${STATUS_LABELS[s.status] ?? s.status}: ${s.count} (${fmtPct(s.pct)})`, startX, doc.y)
    doc.moveDown(0.2)
  }
}

export async function generateDimensionReportPdf(params: DimensionReportInput): Promise<Buffer> {
  const rows = primaryRows(params.resolvedInstances, params.dimension)
  const distribution = computeStatusDistribution(params.resolvedInstances)

  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))

  const startX = 40
  doc.fontSize(18).font('Helvetica-Bold').text(`EduTrack - ${reportTitle(params.dimension)}`)
  doc.moveDown(0.3)
  doc.fontSize(11).font('Helvetica').text(`Período: ${params.from} a ${params.to}`)
  doc.text(`Generado: ${new Date().toISOString()}`)
  doc.moveDown(1)

  doc.fontSize(13).font('Helvetica-Bold').text('Desglose')
  doc.moveDown(0.3)
  doc.fontSize(9).font('Helvetica-Bold')
  const header = doc.y
  doc.text(primaryColumnHeader(params.dimension), startX, header)
  doc.text('Plan.', startX + 230, header)
  doc.text('Punt.%', startX + 290, header)
  doc.text('Tarde%', startX + 360, header)
  doc.text('Aus.%', startX + 430, header)
  doc.moveDown(0.3)

  doc.fontSize(9).font('Helvetica')
  for (const row of rows) {
    const y = doc.y
    doc.text(row.label.slice(0, 40), startX, y, { width: 220 })
    doc.text(String(row.plannedCount), startX + 230, y)
    doc.text(fmtPct(row.punctualityPct), startX + 290, y)
    doc.text(fmtPct(row.lateRatePct), startX + 360, y)
    doc.text(fmtPct(row.aopPct), startX + 430, y)
    doc.moveDown(0.2)
  }

  renderStatusDistributionPdf(doc, distribution, startX)

  doc.end()
  await new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', (err) => reject(err))
  })
  return Buffer.concat(chunks)
}
