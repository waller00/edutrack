import PDFDocument from 'pdfkit'
import { displayValue, type GradeBookMeta } from './gradeBookWorkbook.js'

/**
 * PDF de la libreta y del informe individual (RF-120).
 *
 * Es el documento que se imprime y se archiva, así que lleva siempre de dónde salió: libreta,
 * ciclo, docente y fecha de emisión. Sin eso una hoja suelta no dice a qué grupo pertenece.
 */

export type PdfPeriodRow = {
  periodName: string
  valueHundredths: number | null
  descriptorLabel: string | null
  conceptualJudgement: string | null
  endorsementStatus: string | null
}

export type PdfStudent = {
  lastName: string
  firstName: string
  documentId: string | null
  periods: PdfPeriodRow[]
}

function header(doc: PDFKit.PDFDocument, meta: GradeBookMeta, title: string) {
  doc.fontSize(16).font('Helvetica-Bold').text(title)
  doc.moveDown(0.2)
  doc.fontSize(11).font('Helvetica')
  doc.text(`${meta.subjectName} · ${meta.courseName}${meta.orientationName ? ` — ${meta.orientationName}` : ''}`)
  doc.text(`Ciclo lectivo ${meta.schoolYearLabel}${meta.teacherName ? ` · Docente: ${meta.teacherName}` : ''}`)
  doc.fontSize(9).fillColor('#6B7280').text(`Emitido el ${new Date().toLocaleString('es-UY')}`)
  doc.fillColor('#000000')
  doc.moveDown(0.8)
}

/** Bloque de un estudiante: sus períodos con calificación, descriptor y juicio. */
function studentBlock(doc: PDFKit.PDFDocument, student: PdfStudent, decimals: number) {
  // Salto de página si el bloque no entra entero: partir un estudiante a la mitad hace que la
  // hoja impresa se lea como si le faltara información.
  const estimated = 40 + student.periods.length * 34
  if (doc.y + estimated > doc.page.height - doc.page.margins.bottom) doc.addPage()

  doc.fontSize(12).font('Helvetica-Bold').text(`${student.lastName}, ${student.firstName}`)
  if (student.documentId) {
    doc.fontSize(9).font('Helvetica').fillColor('#6B7280').text(student.documentId)
    doc.fillColor('#000000')
  }
  doc.moveDown(0.2)

  if (student.periods.length === 0) {
    doc.fontSize(9).font('Helvetica').fillColor('#6B7280').text('Sin períodos cerrados.')
    doc.fillColor('#000000')
  }

  for (const period of student.periods) {
    doc.fontSize(9).font('Helvetica-Bold').text(period.periodName, { continued: true })
    doc.font('Helvetica').text(
      `   ${displayValue(period.valueHundredths, decimals)}` +
        (period.descriptorLabel ? `  ·  ${period.descriptorLabel}` : '') +
        (period.endorsementStatus ? `  ·  ${period.endorsementStatus}` : ''),
    )
    if (period.conceptualJudgement) {
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#374151')
      doc.text(period.conceptualJudgement, { indent: 12 })
      doc.fillColor('#000000')
    }
    doc.moveDown(0.25)
  }
  doc.moveDown(0.6)
}

async function render(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

/** PDF de la libreta completa: todos los estudiantes del grupo. */
export async function generateGradeBookPdf(params: {
  meta: GradeBookMeta
  students: readonly PdfStudent[]
  decimals: number
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42 })
  header(doc, params.meta, 'Libreta de calificaciones')

  if (params.students.length === 0) {
    doc.fontSize(10).font('Helvetica').text('El grupo no tiene estudiantes matriculados.')
  }
  for (const student of params.students) {
    studentBlock(doc, student, params.decimals)
  }

  doc.fontSize(8).fillColor('#6B7280').text(
    'Documento generado por EduTrack. Los indicadores automáticos no sustituyen las decisiones ' +
      'pedagógicas adoptadas por la reunión de profesores.',
    { align: 'left' },
  )
  return render(doc)
}

/** Informe individual de un estudiante (RF-120). */
export async function generateStudentReportPdf(params: {
  meta: GradeBookMeta
  student: PdfStudent
  decimals: number
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 42 })
  header(doc, params.meta, 'Informe individual')
  studentBlock(doc, params.student, params.decimals)
  return render(doc)
}
