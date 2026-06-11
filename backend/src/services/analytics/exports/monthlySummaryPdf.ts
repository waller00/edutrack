import PDFDocument from 'pdfkit'
import {
  buildDashboardBreakdowns,
  computeSeriesByWeek,
  computeRangeKpis,
  computePCCount,
  computeStatusDistribution,
} from '../metrics.js'
import type { DashboardBreakdownRow, ResolvedAttendanceByInstance } from '../models.js'

function fmtPct(n: number) {
  return `${n.toFixed(2)}%`
}

const MONTHLY_STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Presente',
  LATE: 'Tarde',
  ABSENT_NOT_JUSTIFIED: 'Ausente no justificado',
  ABSENT_JUSTIFIED: 'Ausente justificado',
  SUBSTITUTED: 'Suplido',
}

function renderBreakdownBlock(doc: PDFKit.PDFDocument, title: string, rows: DashboardBreakdownRow[], startX: number) {
  doc.fontSize(11).font('Helvetica-Bold').text(title, startX, doc.y)
  doc.moveDown(0.2)
  doc.fontSize(9).font('Helvetica')
  for (const row of rows.slice(0, 12)) {
    doc.text(
      `${row.label}: ${row.plannedCount} plan. · tarde ${fmtPct(row.lateRatePct)} · aus. ${fmtPct(row.aopPct)}`,
      startX,
      doc.y,
    )
    doc.moveDown(0.15)
  }
  doc.moveDown(0.4)
}

export async function generateMonthlySummaryPdf(params: {
  resolvedInstances: ResolvedAttendanceByInstance[]
  from: string
  to: string
  filters: Record<string, any>
}): Promise<Buffer> {
  const dashboard = computeRangeKpis(params.resolvedInstances, { plannedInstancesCount: params.resolvedInstances.length })
  const PC_count = await computePCCount({ from: params.from, to: params.to })
  const kpis = { ...dashboard, PC_count }

  const series = computeSeriesByWeek(params.resolvedInstances, params.from, params.to)

  const doc = new PDFDocument({ size: 'A4', margin: 40 })

  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))

  doc.fontSize(18).font('Helvetica-Bold').text('EduTrack - Resumen Asistencias', { align: 'left' })
  doc.moveDown(0.3)
  doc.fontSize(11).font('Helvetica').text(`Periodo: ${params.from} a ${params.to}`)
  doc.text(`Generado: ${new Date().toISOString()}`)
  doc.moveDown(1)

  // Sección KPIs
  doc.fontSize(13).font('Helvetica-Bold').text('KPIs del periodo', { underline: false })
  doc.moveDown(0.3)

  const kpiLines: Array<[string, string]> = [
    ['Puntualidad (Entrada a tiempo)', fmtPct(kpis.M1_PUNCTUALITY_pct)],
    ['Tasa LATE', fmtPct(kpis.M2_LATE_RATE_pct)],
    ['Ausentismo sobre plan (AOP)', fmtPct(kpis.M4_AOP_pct)],
    ['Cobertura real (CP)', fmtPct(kpis.M6_COVERAGE_CP_pct)],
    ['Delta horas vs plan (% del plan)', fmtPct(kpis.M8_HOURS_DELTA_pct)],
    ['Licencias inactivas', String(kpis.PC_count)],
  ]

  const startX = 40
  let y = doc.y
  for (const [label, value] of kpiLines) {
    doc.fontSize(10).font('Helvetica').text(`${label}:`, startX, y)
    doc.fontSize(10).font('Helvetica-Bold').text(value, startX + 360, y)
    y += 16
  }

  doc.moveDown(1)

  // Sección tendencia semanal
  doc.fontSize(13).font('Helvetica-Bold').text('Tendencias semanales (Late & AOP)', { underline: false })
  doc.moveDown(0.3)

  // Tabla simple
  doc.fontSize(9).font('Helvetica-Bold')
  doc.text('Semana', startX, doc.y)
  doc.text('Late rate', startX + 150, doc.y)
  doc.text('AOP', startX + 250, doc.y)
  doc.moveDown(0.2)

  doc.fontSize(9).font('Helvetica')
  for (const s of series.slice(-12)) {
    doc.text(s.period, startX, doc.y)
    doc.text(fmtPct(s.lateRate), startX + 150, doc.y)
    doc.text(fmtPct(s.aop), startX + 250, doc.y)
    doc.moveDown(0.2)
  }

  // Sección desgloses (rol / tipo de evento) + distribución de estados
  const breakdowns = buildDashboardBreakdowns(params.resolvedInstances)
  const distribution = computeStatusDistribution(params.resolvedInstances)
  doc.moveDown(1)
  doc.fontSize(13).font('Helvetica-Bold').text('Desgloses', { underline: false })
  doc.moveDown(0.3)
  renderBreakdownBlock(doc, 'Por rol', breakdowns.byRole, startX)
  renderBreakdownBlock(doc, 'Por tipo de evento', breakdowns.byEventType, startX)
  if (breakdowns.byCourse.length > 0) {
    renderBreakdownBlock(doc, 'Por curso', breakdowns.byCourse, startX)
  }

  doc.fontSize(13).font('Helvetica-Bold').text('Distribución de estados', startX, doc.y)
  doc.moveDown(0.3)
  doc.fontSize(9).font('Helvetica')
  for (const s of distribution.rows) {
    doc.text(`${MONTHLY_STATUS_LABELS[s.status] ?? s.status}: ${s.count} (${fmtPct(s.pct)})`, startX, doc.y)
    doc.moveDown(0.15)
  }

  // Filtros (para trazabilidad)
  doc.moveDown(1)
  doc.fontSize(13).font('Helvetica-Bold').text('Filtros aplicados', { underline: false })
  doc.moveDown(0.3)
  doc.fontSize(9).font('Helvetica')
  doc.text(JSON.stringify(params.filters, null, 2))

  doc.end()

  await new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', (err) => reject(err))
  })

  return Buffer.concat(chunks)
}
