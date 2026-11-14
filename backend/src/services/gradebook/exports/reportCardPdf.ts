import PDFDocument from 'pdfkit'
import type { InstitutionBranding } from '../../institution-branding.js'
import type { ReportCard, ReportCardSubject } from '../report-card.js'

/**
 * Boletín del período, en PDF: la planilla que el liceo imprime y le entrega a la familia.
 *
 * Copia su forma —A4 apaisado, una hoja por alumno—: por asignatura C, R y el informe de actuación;
 * abajo el informe de la reunión (con su C y su R), las inasistencias (J, I y el total) y los
 * lugares de la fecha y las firmas, que se completan a mano. Sellos y firmas no se imprimen. Arriba
 * a la izquierda, el logo y el nombre de la institución que se cargan en Configuración.
 *
 * Se dibuja como tabla con posiciones fijas, sin márgenes de pdfkit: así ningún texto dispara un
 * salto de página por su cuenta y cada boletín decide dónde se corta.
 */

const PAGE_WIDTH = 841.89
const PAGE_HEIGHT = 595.28
const MARGIN = 24
const LEFT = MARGIN
const TOP = MARGIN
const BOTTOM = PAGE_HEIGHT - MARGIN
const WIDTH = PAGE_WIDTH - 2 * MARGIN

const SUBJECT_W = 180
const GRADE_W = 34
const X_C = LEFT + SUBJECT_W
const X_R = X_C + GRADE_W
const X_INFORME = X_R + GRADE_W
const INFORME_W = LEFT + WIDTH - X_INFORME

const HEADER_H = 50
const GROUP_LABEL_W = 56
const GROUP_VALUE_W = 130
const NAME_W = INFORME_W - GROUP_LABEL_W - GROUP_VALUE_W
/** Renglón del período debajo del nombre del alumno. */
const SUBTITLE_H = 11
const LOGO_INSET = 3
const LOGO_SIZE = HEADER_H - 2 * LOGO_INSET
const HEAD1_H = 16
const HEAD2_H = 14
const ABSENCE_ROW_H = 15
const DATE_ROW_H = 24
/** Inasistencias y fecha: los recuadros de firma ocupan las tres filas. */
const CLOSING_H = 2 * ABSENCE_ROW_H + DATE_ROW_H
const TOTAL_W = 120
const SIGNATURE_W = (INFORME_W - TOTAL_W) / 2
const MIN_ROW_H = 17
const MIN_MEETING_H = 28
/** Lo más que crece una fila para que la tabla llene la hoja, como la planilla en papel. */
const MAX_EXTRA_H = 14
const PAD_X = 4
const PAD_Y = 3

/** De la más cómoda a la mínima legible: se usa la mayor con la que el boletín entra en una hoja. */
const FONT_SIZES = [9, 8.5, 8, 7.5, 7, 6.5] as const

const INK = '#000000'
const MUTED = '#4B5563'
const HEAD_FILL = '#EEF0F3'

type Doc = PDFKit.PDFDocument
/** Imagen ya abierta por pdfkit: reusarla en cada hoja la incrusta una sola vez en el PDF. */
type OpenedImage = { width: number; height: number }
/** Lo que encabeza cada hoja: el logo abierto y el nombre de la institución. */
type Brand = { name: string | null; logo: OpenedImage | null }
type TextStyle = { size: number; bold?: boolean; italic?: boolean; align?: 'left' | 'center'; color?: string }

function fontName(style: TextStyle): string {
  if (style.bold && style.italic) return 'Helvetica-BoldOblique'
  if (style.bold) return 'Helvetica-Bold'
  return style.italic ? 'Helvetica-Oblique' : 'Helvetica'
}

function textHeight(doc: Doc, text: string, width: number, style: TextStyle): number {
  doc.font(fontName(style)).fontSize(style.size)
  return doc.heightOfString(text, { width: width - 2 * PAD_X })
}

/** El tamaño más grande, hasta `max`, con el que el texto entra en la celda. */
function fitSize(doc: Doc, text: string, width: number, height: number, max: number, min: number): number {
  for (let size = max; size > min; size -= 0.5) {
    if (textHeight(doc, text, width, { size, bold: true }) <= height - 2 * PAD_Y) return size
  }
  return min
}

function cell(doc: Doc, x: number, y: number, w: number, h: number, fill?: string) {
  doc.lineWidth(0.6)
  if (fill) doc.rect(x, y, w, h).fillAndStroke(fill, INK)
  else doc.rect(x, y, w, h).stroke(INK)
}

/** Texto centrado en vertical dentro de un área. */
function textIn(doc: Doc, x: number, y: number, w: number, h: number, text: string, style: TextStyle) {
  if (!text) return
  const height = textHeight(doc, text, w, style)
  // La caja de la línea incluye el descendente: sin el empujón el texto se ve más arriba del centro.
  const top = Math.max(PAD_Y / 2, (h - height) / 2 + style.size * 0.1)
  doc.fillColor(style.color ?? INK).text(text, x + PAD_X, y + top, {
    width: w - 2 * PAD_X,
    align: style.align ?? 'left',
  })
}

/** Una celda con su texto. */
function box(doc: Doc, x: number, y: number, w: number, h: number, text: string, style: TextStyle, fill?: string) {
  cell(doc, x, y, w, h, fill)
  textIn(doc, x, y, w, h, text, style)
}

const label = (size: number): TextStyle => ({ size, bold: true, align: 'center' })

/** "LIESEGANG RODRÍGUEZ Orazio": apellidos en mayúscula, como en la planilla. */
function studentName(card: ReportCard): string {
  return `${card.student.lastName.toLocaleUpperCase('es-UY')} ${card.student.firstName}`.trim()
}

function groupText(card: ReportCard): string {
  const { courseName, orientationName, schoolYearLabel } = card.group
  return `${courseName}${orientationName ? ` ${orientationName}` : ''}\n${schoolYearLabel}`
}

/** Logo y nombre de la institución, como la planilla; sin ninguno de los dos, "BOLETÍN". */
function institutionCell(doc: Doc, brand: Brand, y: number) {
  if (!brand.logo && !brand.name) {
    box(doc, LEFT, y, SUBJECT_W, HEADER_H, 'BOLETÍN', label(13))
    return
  }
  cell(doc, LEFT, y, SUBJECT_W, HEADER_H)
  let x = LEFT
  if (brand.logo) {
    // pdfkit acepta la imagen ya abierta aunque sus tipos sólo declaren Buffer.
    doc.image(brand.logo as unknown as Buffer, LEFT + LOGO_INSET, y + LOGO_INSET, {
      fit: [LOGO_SIZE, LOGO_SIZE],
      align: 'center',
      valign: 'center',
    })
    x += LOGO_SIZE + LOGO_INSET
  }
  if (brand.name) {
    const name = brand.name.toLocaleUpperCase('es-UY')
    const width = LEFT + SUBJECT_W - x
    textIn(doc, x, y, width, HEADER_H, name, { size: fitSize(doc, name, width, HEADER_H, 11, 6), bold: true })
  }
}

/** El alumno y, debajo, de qué boletín es. */
function studentCell(doc: Doc, card: ReportCard, y: number) {
  cell(doc, X_INFORME, y, NAME_W, HEADER_H)
  const name = studentName(card)
  const nameHeight = HEADER_H - SUBTITLE_H
  textIn(doc, X_INFORME, y, NAME_W, nameHeight, name, label(fitSize(doc, name, NAME_W, nameHeight, 15, 8)))
  const subtitle = `Boletín · ${card.period.name}`
  textIn(doc, X_INFORME, y + nameHeight - 2, NAME_W, SUBTITLE_H, subtitle, { size: 7.5, align: 'center', color: MUTED })
}

function header(doc: Doc, card: ReportCard, brand: Brand, y: number): number {
  institutionCell(doc, brand, y)
  box(doc, X_C, y, 2 * GRADE_W, HEADER_H, 'ALUMNO/A', label(8))
  studentCell(doc, card, y)
  const xGroup = X_INFORME + NAME_W
  box(doc, xGroup, y, GROUP_LABEL_W, HEADER_H, 'GRUPO', label(8))
  const group = groupText(card)
  box(doc, xGroup + GROUP_LABEL_W, y, GROUP_VALUE_W, HEADER_H, group, label(fitSize(doc, group, GROUP_VALUE_W, HEADER_H, 10, 6)))
  return y + HEADER_H
}

function columnHeads(doc: Doc, card: ReportCard, y: number): number {
  const height = HEAD1_H + HEAD2_H
  const judgementTitle = (card.period.judgementLabel ?? 'Informe de actuación').toLocaleUpperCase('es-UY')
  const column = card.period.columnLabel
  box(doc, LEFT, y, SUBJECT_W, height, 'UNIDAD CURRICULAR', label(10), HEAD_FILL)
  box(doc, X_C, y, 2 * GRADE_W, HEAD1_H, column, label(fitSize(doc, column, 2 * GRADE_W, HEAD1_H, 9, 5)), HEAD_FILL)
  box(doc, X_C, y + HEAD1_H, GRADE_W, HEAD2_H, 'C', label(9), HEAD_FILL)
  box(doc, X_R, y + HEAD1_H, GRADE_W, HEAD2_H, 'R', label(9), HEAD_FILL)
  box(doc, X_INFORME, y, INFORME_W, height, judgementTitle, label(10), HEAD_FILL)
  return y + height
}

/** `800` → `"8"`, `850` → `"8,5"`. Vacío sin nota: el casillero queda en blanco, como en papel. */
function gradeText(hundredths: number | null): string {
  return hundredths == null ? '' : String(hundredths / 100).replace('.', ',')
}

/** Lo que va en el informe de una materia: el del docente, o por qué no hay. */
function subjectNote(subject: ReportCardSubject, size: number): { text: string; style: TextStyle } {
  const notice: TextStyle = { size, italic: true, color: MUTED }
  if (!subject.closed) return { text: 'Pendiente: la libreta todavía no cerró este período.', style: notice }
  if (subject.conceptualJudgement) return { text: subject.conceptualJudgement, style: { size } }
  const empty = subject.valueHundredths == null && subject.conductValueHundredths == null
  return { text: empty ? 'Sin calificación en este período.' : '', style: notice }
}

function subjectName(subject: ReportCardSubject): string {
  return subject.subjectName.toLocaleUpperCase('es-UY')
}

function subjectRowHeight(doc: Doc, subject: ReportCardSubject, size: number): number {
  const note = subjectNote(subject, size)
  const name = textHeight(doc, subjectName(subject), SUBJECT_W, { size, bold: true })
  const judgement = note.text ? textHeight(doc, note.text, INFORME_W, note.style) : 0
  return Math.max(MIN_ROW_H, Math.max(name, judgement) + 2 * PAD_Y)
}

function subjectRow(doc: Doc, subject: ReportCardSubject, y: number, height: number, size: number) {
  const note = subjectNote(subject, size)
  box(doc, LEFT, y, SUBJECT_W, height, subjectName(subject), { size, bold: true })
  box(doc, X_C, y, GRADE_W, height, gradeText(subject.conductValueHundredths), label(size + 2))
  box(doc, X_R, y, GRADE_W, height, gradeText(subject.valueHundredths), label(size + 2))
  box(doc, X_INFORME, y, INFORME_W, height, note.text, note.style)
}

/** El juicio de la reunión ocupa también las columnas C y R: la reunión no pone notas propias. */
const MEETING_JUDGEMENT_W = LEFT + WIDTH - X_C

function meetingRowHeight(doc: Doc, card: ReportCard, size: number): number {
  const { judgement } = card.meeting
  if (!judgement) return MIN_MEETING_H
  return Math.max(MIN_MEETING_H, textHeight(doc, judgement, MEETING_JUDGEMENT_W, label(size + 1.5)) + 4 * PAD_Y)
}

/**
 * Lo que la reunión decidió sobre el alumno: su juicio, en un recuadro que cubre C, R e informe.
 * C y R son de cada materia; la reunión no pone conducta ni rendimiento propios.
 */
function meetingRow(doc: Doc, card: ReportCard, y: number, height: number, size: number) {
  box(doc, LEFT, y, SUBJECT_W, height, 'INFORME REUNIÓN', label(9), HEAD_FILL)
  box(doc, X_C, y, MEETING_JUDGEMENT_W, height, card.meeting.judgement ?? '', label(size + 1.5))
}

/** Recuadro de firma: el rótulo arriba y el resto en blanco para firmar a mano. */
function signature(doc: Doc, x: number, y: number, text: string) {
  cell(doc, x, y, SIGNATURE_W, CLOSING_H)
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK).text(text, x + PAD_X, y + PAD_Y, {
    width: SIGNATURE_W - 2 * PAD_X,
    align: 'center',
  })
}

/** "acumuladas al 30/09": son las del año hasta el fin del período, no sólo las del período. */
function absencesSpan(untilYmd: string | null): string {
  if (!untilYmd) return 'acumuladas en el año'
  const [, month, day] = untilYmd.split('-')
  return `acumuladas al ${day}/${month}`
}

function closingRows(doc: Doc, card: ReportCard, y: number) {
  const { justified, unjustified } = card.attendance
  const second = y + ABSENCE_ROW_H
  cell(doc, LEFT, y, SUBJECT_W, 2 * ABSENCE_ROW_H, HEAD_FILL)
  textIn(doc, LEFT, y + 1, SUBJECT_W, ABSENCE_ROW_H + 2, 'INASISTENCIAS', label(9))
  textIn(doc, LEFT, second - 1, SUBJECT_W, ABSENCE_ROW_H, absencesSpan(card.attendance.untilYmd), {
    size: 7,
    align: 'center',
    color: MUTED,
  })
  box(doc, X_C, y, GRADE_W, ABSENCE_ROW_H, 'J', label(8), HEAD_FILL)
  box(doc, X_R, y, GRADE_W, ABSENCE_ROW_H, 'I', label(8), HEAD_FILL)
  box(doc, X_C, second, GRADE_W, ABSENCE_ROW_H, String(justified), label(10))
  box(doc, X_R, second, GRADE_W, ABSENCE_ROW_H, String(unjustified), label(10))
  // Las tardes suman media falta al total, pero la planilla no las detalla: sólo J, I y TOTAL.
  box(doc, X_INFORME, y, TOTAL_W, ABSENCE_ROW_H, 'TOTAL', label(8), HEAD_FILL)
  box(doc, X_INFORME, second, TOTAL_W, ABSENCE_ROW_H, String(card.absenceTotal), label(10))

  const dateY = y + 2 * ABSENCE_ROW_H
  box(doc, LEFT, dateY, SUBJECT_W, DATE_ROW_H, 'FECHA', label(9), HEAD_FILL)
  cell(doc, X_C, dateY, 2 * GRADE_W + TOTAL_W, DATE_ROW_H)

  signature(doc, X_INFORME + TOTAL_W, y, 'FIRMA PADRE, MADRE, ENCARGADO')
  signature(doc, X_INFORME + TOTAL_W + SIGNATURE_W, y, 'FIRMA FUNCIONARIO')
}

function totalHeight(doc: Doc, card: ReportCard, size: number): number {
  const rows = card.subjects.reduce((acc, subject) => acc + subjectRowHeight(doc, subject, size), 0)
  return HEADER_H + HEAD1_H + HEAD2_H + rows + meetingRowHeight(doc, card, size) + CLOSING_H
}

/** La letra más grande con la que el boletín entra entero en una hoja. */
function pageFontSize(doc: Doc, card: ReportCard): number {
  return FONT_SIZES.find((size) => TOP + totalHeight(doc, card, size) <= BOTTOM) ?? FONT_SIZES[FONT_SIZES.length - 1]
}

/** Encabezado del alumno y de las columnas: cada hoja del boletín lo repite. */
function startSheet(doc: Doc, card: ReportCard, brand: Brand): number {
  return columnHeads(doc, card, header(doc, card, brand, TOP))
}

/**
 * Un boletín. Casi siempre entra en una hoja achicando la letra; si con la mínima tampoco (informes
 * muy largos), sigue en otra con el mismo encabezado en vez de cortar un informe al medio. Si sobra
 * lugar, se reparte entre las filas.
 */
function reportCardPages(doc: Doc, card: ReportCard, brand: Brand) {
  const size = pageFontSize(doc, card)
  const spare = Math.max(0, BOTTOM - TOP - totalHeight(doc, card, size))
  // Redondeado para abajo: repartir el sobrante exacto pasa el borde por un error de coma flotante.
  const extra = Math.min(MAX_EXTRA_H, Math.floor((spare / (card.subjects.length + 1)) * 10) / 10)
  let y = startSheet(doc, card, brand)
  for (const subject of card.subjects) {
    const height = subjectRowHeight(doc, subject, size) + extra
    if (y + height > BOTTOM) {
      doc.addPage()
      y = startSheet(doc, card, brand)
    }
    subjectRow(doc, subject, y, height, size)
    y += height
  }
  const meetingHeight = meetingRowHeight(doc, card, size) + extra
  if (y + meetingHeight + CLOSING_H > BOTTOM) {
    doc.addPage()
    y = startSheet(doc, card, brand)
  }
  meetingRow(doc, card, y, meetingHeight, size)
  closingRows(doc, card, y + meetingHeight)
}

/** Abre el logo una vez por documento. Uno que pdfkit no puede leer no impide imprimir boletines. */
function openLogo(doc: Doc, bytes: Buffer | null): OpenedImage | null {
  if (!bytes) return null
  try {
    return (doc as unknown as { openImage(src: Buffer): OpenedImage }).openImage(bytes)
  } catch (error) {
    console.warn('[reportCardPdf] logo ilegible, se imprime sin él:', error)
    return null
  }
}

/**
 * Varios boletines en un solo PDF, cada uno desde una hoja nueva: es como se imprimen los de un
 * grupo para la entrega a las familias.
 */
/** Sin nombre ni logo cargados en Configuración → Institución. */
const NO_BRANDING: InstitutionBranding = Object.freeze({ name: null, logo: null })

export function generateReportCardsPdf(
  cards: readonly ReportCard[],
  institution: InstitutionBranding = NO_BRANDING,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 })
    const brand: Brand = { name: institution.name, logo: openLogo(doc, institution.logo) }
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    cards.forEach((card, index) => {
      if (index > 0) doc.addPage()
      reportCardPages(doc, card, brand)
    })

    doc.end()
  })
}

export function generateReportCardPdf(card: ReportCard, institution?: InstitutionBranding): Promise<Buffer> {
  return generateReportCardsPdf([card], institution)
}
