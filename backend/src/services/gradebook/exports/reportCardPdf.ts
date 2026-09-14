import PDFDocument from 'pdfkit'
import { formatAverage, type ReportCard } from '../report-card.js'
import { formatAbsenceUnits } from '../../student-attendance/absence-weight.js'

/**
 * Boletín del período, en PDF.
 *
 * Es lo que se imprime y se le entrega a la familia, así que lleva el encabezado completo del
 * estudiante y del grupo: una hoja suelta tiene que poder decir de quién es sin depender de nada.
 *
 * A diferencia del resto de las exportaciones —que son por libreta, o sea de una materia— éste
 * recorre todas las asignaturas del grupo.
 */

const CONDUCT_LABELS: Record<number, string> = {
  100: 'Mala',
  200: 'Regular',
  300: 'Buena',
  400: 'Muy buena',
}

function conductText(value: number | null): string {
  if (value == null) return '—'
  return CONDUCT_LABELS[value] ?? String(value / 100)
}

function header(doc: PDFKit.PDFDocument, card: ReportCard) {
  doc.fontSize(16).font('Helvetica-Bold').text('Boletín de calificaciones')
  doc.moveDown(0.2)
  doc.fontSize(12).font('Helvetica-Bold').text(`${card.student.lastName}, ${card.student.firstName}`)
  doc.fontSize(10).font('Helvetica')

  const identity = [
    card.student.documentId ? `C.I. ${card.student.documentId}` : null,
    card.student.birthDate
      ? `Nac. ${card.student.birthDate.toISOString().slice(0, 10).split('-').reverse().join('/')}`
      : null,
  ].filter(Boolean)
  if (identity.length) doc.text(identity.join(' · '))

  doc.text(
    `${card.group.courseName}${card.group.orientationName ? ` — ${card.group.orientationName}` : ''}` +
      ` · Ciclo ${card.group.schoolYearLabel} · ${card.period.name}`,
  )
  doc.fontSize(9).fillColor('#6B7280').text(`Emitido el ${new Date().toLocaleString('es-UY')}`)
  doc.fillColor('#000000')
  doc.moveDown(0.8)
}

function subjectRows(doc: PDFKit.PDFDocument, card: ReportCard, decimals: number) {
  doc.fontSize(11).font('Helvetica-Bold').text('Asignaturas')
  doc.moveDown(0.3)

  for (const subject of card.subjects) {
    // Sin salto de página el último renglón puede quedar cortado al medio al imprimir.
    if (doc.y > doc.page.height - 120) doc.addPage()

    doc.fontSize(10).font('Helvetica-Bold').text(subject.subjectName, { continued: true })
    doc
      .font('Helvetica')
      .text(
        `   ${subject.valueHundredths == null ? 'Sin calificar' : formatAverage(subject.valueHundredths, decimals)}` +
          `${subject.descriptor ? ` · ${subject.descriptor}` : ''}` +
          `${subject.conductValueHundredths != null ? ` · Conducta: ${conductText(subject.conductValueHundredths)}` : ''}`,
      )
    if (subject.conceptualJudgement) {
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#374151').text(subject.conceptualJudgement, { indent: 16 })
      doc.fillColor('#000000')
    }
    doc.moveDown(0.4)
  }
}

function summary(doc: PDFKit.PDFDocument, card: ReportCard, decimals: number) {
  doc.moveDown(0.5)
  doc.fontSize(11).font('Helvetica-Bold').text('Resumen del período')
  doc.fontSize(10).font('Helvetica')

  // El promedio va siempre con al menos un decimal: se usa para escolaridad y abanderados.
  doc.text(`Promedio: ${formatAverage(card.averageHundredths, decimals)}`)
  if (card.pendingCount > 0) {
    doc
      .fontSize(9)
      .fillColor('#6B7280')
      .text(
        `Calculado sobre las asignaturas calificadas: ${card.pendingCount} todavía sin nota.`,
      )
    doc.fillColor('#000000').fontSize(10)
  }
  doc.text(`Conducta: ${conductText(card.conductValueHundredths)}`)
  doc.text(
    `Inasistencias: ${formatAbsenceUnits(card.attendance.absenceHundredths)}` +
      `${card.attendance.justifiedCount > 0 ? ` (${card.attendance.justifiedCount} justificadas)` : ''}`,
  )
}

export function generateReportCardPdf(card: ReportCard, decimals = 1): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    header(doc, card)
    subjectRows(doc, card, decimals)
    summary(doc, card, decimals)

    doc
      .moveDown(1)
      .fontSize(8)
      .fillColor('#6B7280')
      .text(
        'El promedio es un indicador automático calculado sobre las calificaciones del período; ' +
          'no sustituye las decisiones de la reunión de profesores.',
      )

    doc.end()
  })
}
