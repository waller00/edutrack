import PDFDocument from 'pdfkit'
import { computeSeriesByWeek, computeRangeKpis, computePCCount } from '../metrics.js'
import type { ResolvedAttendanceByInstance } from '../models.js'

function fmtPct(n: number) {
  return `${n.toFixed(2)}%`
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
    ['Licencias PENDING críticas', String(kpis.PC_count)],
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

