import PDFDocument from 'pdfkit'
import type { InstitutionBranding } from '../institution-branding.js'
import { formatCount, formatDateTime, formatDecimal, formatRatio, formatShare, ratioValue } from './format.js'
import {
  isShare,
  type BarsBlock,
  type Block,
  type Cell,
  type Column,
  type ColumnKind,
  type NoteBlock,
  type Part,
  type PartsBlock,
  type ReportDoc,
  type ReportSection,
  type Share,
  type TableBlock,
  type Tile,
  type TilesBlock,
} from './model.js'

/**
 * Un informe en PDF: A4 vertical; en cada hoja el logo y el nombre de la institución
 * (Configuración → Institución), el título y el período; al pie la fecha, el aviso de datos
 * personales y "Página X de Y". Cada sección arranca en hoja nueva y las tablas repiten su
 * encabezado al cortar.
 *
 * Todo se ubica a mano (posiciones fijas): el margen inferior de pdfkit queda por debajo del pie,
 * así ningún texto abre una hoja por su cuenta y cada bloque decide dónde se corta.
 *
 * Las barras nunca son la única lectura (RNF 7.2): cada una lleva su texto con «n de N (x %)».
 */

const PAGE_W = 595.28
const PAGE_H = 841.89
const LEFT = 40
const WIDTH = PAGE_W - 2 * LEFT
const HEADER_Y = 28
const TOP = 104
const BOTTOM = PAGE_H - 58
const FOOTER_Y = PAGE_H - 40
const LOGO_SIZE = 44

const INK = '#0F172A'
const MUTED = '#475569'
const SOFT = '#64748B'
const RULE = '#E2E8F0'
const HEAD_FILL = '#F1F5F9'
const ZEBRA = '#F8FAFC'
const ACCENT = '#1F4E79'
const BAR = '#2A78D6'
const TRACK = '#E2E8F0'
const NO_DATA = '#CBD5E1'
/** Los colores de las series de la pantalla (`SERIES_COLORS`). */
const PART_COLORS = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4']

type Doc = PDFKit.PDFDocument
type Align = 'left' | 'right' | 'center'
type Style = { size: number; bold?: boolean; color?: string; align?: Align }
/** Imagen ya abierta por pdfkit: reusarla en cada hoja la incrusta una sola vez. */
type OpenedImage = { width: number; height: number }
type Brand = { name: string | null; logo: OpenedImage | null }
/** Dónde va el próximo bloque de la hoja actual. */
type Ctx = { doc: Doc; y: number }

const SECTION: Style = { size: 15, bold: true, color: ACCENT }
const INTRO: Style = { size: 9, color: MUTED }
const BLOCK_TITLE: Style = { size: 10.5, bold: true, color: INK }
const BLOCK_DESC: Style = { size: 8.5, color: MUTED }
const HEADER_CELL: Style = { size: 7.5, bold: true, color: INK }
const BODY_CELL: Style = { size: 8, color: INK }
const EMPTY: Style = { size: 8.5, color: SOFT }
const NOTE: Style = { size: 8.5, color: INK }
const FILTER: Style = { size: 9, color: MUTED }
const LEGEND: Style = { size: 8, color: INK }
const TILE_LABEL: Style = { size: 8, color: MUTED }
const TILE_VALUE: Style = { size: 15, bold: true, color: INK }
const TILE_DETAIL: Style = { size: 7.5, color: MUTED }

// ─── Texto ──────────────────────────────────────────────────────────────────

/** Lo que Helvetica dibuja además de Latin-1 (la codificación WinAnsi de pdfkit). */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const REPLACEMENTS: Record<string, string> = {
  '−': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '→': '->',
  '≥': '>=',
  '≤': '<=',
  '▲': '',
}

const isLatin1Printable = (code: number) => (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)

/**
 * El texto con sólo lo que Helvetica sabe dibujar: tildes, ñ, «·», «–» y «…» sí; ▲, → o ✓ no
 * (saldrían como basura). Lo que no se puede reemplazar sale como «?».
 */
export function winAnsi(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\n' || isLatin1Printable(code) || WINANSI_EXTRA.has(ch)) out += ch
    else out += REPLACEMENTS[ch] ?? '?'
  }
  return out
}

function useFont(doc: Doc, style: Style): Doc {
  return doc.font(style.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(style.size)
}

function measure(doc: Doc, text: string, width: number, style: Style): number {
  return useFont(doc, style).heightOfString(winAnsi(text), { width })
}

function write(doc: Doc, text: string, x: number, y: number, width: number, style: Style) {
  useFont(doc, style)
    .fillColor(style.color ?? INK)
    .text(winAnsi(text), x, y, { width, align: style.align ?? 'left' })
}

function rule(doc: Doc, y: number, color = RULE, width = 0.6) {
  doc.moveTo(LEFT, y).lineTo(LEFT + WIDTH, y).lineWidth(width).strokeColor(color).stroke()
}

/** Si el bloque no entra en lo que queda de la hoja, pasa a la siguiente. */
function ensure(ctx: Ctx, height: number) {
  if (ctx.y + height <= BOTTOM) return
  ctx.doc.addPage()
  ctx.y = TOP
}

function paragraph(ctx: Ctx, text: string, style: Style, gap = 6) {
  const height = measure(ctx.doc, text, WIDTH, style)
  ensure(ctx, height)
  write(ctx.doc, text, LEFT, ctx.y, WIDTH, style)
  ctx.y += height + gap
}

/** Título y descripción de un bloque, sin quedar solos al pie: piden lugar para `keepWith` más. */
function blockTitle(ctx: Ctx, title: string, description: string | undefined, keepWith: number) {
  const titleHeight = measure(ctx.doc, title, WIDTH, BLOCK_TITLE)
  const descHeight = description ? measure(ctx.doc, description, WIDTH, BLOCK_DESC) + 2 : 0
  ensure(ctx, titleHeight + descHeight + 6 + keepWith)
  write(ctx.doc, title, LEFT, ctx.y, WIDTH, BLOCK_TITLE)
  ctx.y += titleHeight + 2
  if (description) {
    write(ctx.doc, description, LEFT, ctx.y, WIDTH, BLOCK_DESC)
    ctx.y += descHeight
  }
  ctx.y += 4
}

// ─── Mosaicos ───────────────────────────────────────────────────────────────

const TILE_PAD = 8
const TILE_GAP = 10
const TILES_PER_ROW = 2

function tileHeight(doc: Doc, tile: Tile, width: number): number {
  const inner = width - 2 * TILE_PAD
  return (
    2 * TILE_PAD +
    measure(doc, tile.label, inner, TILE_LABEL) +
    measure(doc, tile.value, inner, TILE_VALUE) +
    measure(doc, tile.detail, inner, TILE_DETAIL) +
    4
  )
}

function drawTile(doc: Doc, tile: Tile, x: number, y: number, width: number, height: number) {
  const inner = width - 2 * TILE_PAD
  doc.lineWidth(0.6).roundedRect(x, y, width, height, 4).fillAndStroke('#FFFFFF', RULE)
  let cursor = y + TILE_PAD
  for (const [text, style] of [
    [tile.label, TILE_LABEL],
    [tile.value, TILE_VALUE],
    [tile.detail, TILE_DETAIL],
  ] as const) {
    write(doc, text, x + TILE_PAD, cursor, inner, style)
    cursor += measure(doc, text, inner, style) + 2
  }
}

function drawTiles(ctx: Ctx, block: TilesBlock) {
  const width = (WIDTH - TILE_GAP * (TILES_PER_ROW - 1)) / TILES_PER_ROW
  for (let i = 0; i < block.tiles.length; i += TILES_PER_ROW) {
    const row = block.tiles.slice(i, i + TILES_PER_ROW)
    const height = Math.max(...row.map((tile) => tileHeight(ctx.doc, tile, width)))
    ensure(ctx, height)
    row.forEach((tile, j) => drawTile(ctx.doc, tile, LEFT + j * (width + TILE_GAP), ctx.y, width, height))
    ctx.y += height + TILE_GAP
  }
  ctx.y += 2
}

// ─── Tablas ─────────────────────────────────────────────────────────────────

const CELL_PAD_X = 4
const CELL_PAD_Y = 3.5
const SHARE_BAR_H = 3
/** Cómo se reparte el ancho que sobra: casi todo a los textos (nombres) y a las barras. */
const DEFAULT_WEIGHT: Record<ColumnKind, number> = { text: 3, count: 0.3, decimal: 0.3, share: 1.4, percent: 0.3 }

const kindOf = (column: Column): ColumnKind => column.kind ?? 'text'

type Row = { texts: string[]; cells: readonly (Cell | undefined)[] | null }

const sum = (values: readonly number[]) => values.reduce((acc, value) => acc + value, 0)

/**
 * Lo mínimo de cada columna: que ninguna palabra del encabezado se corte («Registro/s») y que un
 * número o un «1.597 de 1.600 (99,8 %)» entre en una línea. Los textos (nombres) sí pueden partirse.
 */
function minColumnWidth(doc: Doc, column: Column, texts: readonly string[]): number {
  useFont(doc, HEADER_CELL)
  const headerWord = Math.max(...column.header.split(/\s+/).map((word) => doc.widthOfString(winAnsi(word))))
  if (kindOf(column) === 'text') return headerWord + 2 * CELL_PAD_X + 1
  useFont(doc, BODY_CELL)
  const widest = texts.reduce((acc, text) => Math.max(acc, doc.widthOfString(winAnsi(text))), 0)
  return Math.max(headerWord, widest) + 2 * CELL_PAD_X + 1
}

/** Cada columna con su mínimo y lo que sobra repartido según su peso. */
function columnWidths(doc: Doc, columns: readonly Column[], rows: readonly Row[]): number[] {
  const weights = columns.map((column) => column.weight ?? DEFAULT_WEIGHT[kindOf(column)])
  const mins = columns.map((column, i) => minColumnWidth(doc, column, rows.map((row) => row.texts[i])))
  const spare = WIDTH - sum(mins)
  if (spare <= 0) return mins.map((min) => (min / sum(mins)) * WIDTH)
  return mins.map((min, i) => min + (spare * weights[i]) / sum(weights))
}

/** Cómo se escribe una celda en el PDF. */
export function cellText(cell: Cell | undefined, column: Column): string {
  if (cell === null || cell === undefined || cell === '') return '—'
  if (isShare(cell)) return kindOf(column) === 'percent' ? formatRatio(cell.part, cell.total) : formatShare(cell.part, cell.total)
  if (typeof cell === 'number') return kindOf(column) === 'decimal' ? formatDecimal(cell, column.digits ?? 1, column.fixed) : formatCount(cell)
  return cell
}

const alignOf = (column: Column): Align => (['count', 'decimal', 'percent'].includes(kindOf(column)) ? 'right' : 'left')

/** La barrita va sólo en las columnas `share`. */
const hasBar = (cell: Cell | undefined, column: Column) => isShare(cell ?? null) && kindOf(column) === 'share'

function rowHeight(doc: Doc, row: Row, widths: readonly number[], columns: readonly Column[], style: Style): number {
  let tallest = 0
  row.texts.forEach((text, i) => {
    const bar = row.cells && hasBar(row.cells[i], columns[i]) ? SHARE_BAR_H + 2 : 0
    tallest = Math.max(tallest, measure(doc, text, widths[i] - 2 * CELL_PAD_X, style) + bar)
  })
  return tallest + 2 * CELL_PAD_Y
}

function shareBar(doc: Doc, value: Share, x: number, y: number, width: number) {
  const ratio = ratioValue(value.part, value.total)
  if (ratio === null) return
  doc.rect(x, y, width, SHARE_BAR_H).fill(TRACK)
  if (ratio > 0) doc.rect(x, y, Math.max(0.8, (width * Math.min(ratio, 100)) / 100), SHARE_BAR_H).fill(BAR)
}

function drawRow(doc: Doc, y: number, row: Row, layout: { widths: readonly number[]; columns: readonly Column[] }, style: Style, fill?: string) {
  const height = rowHeight(doc, row, layout.widths, layout.columns, style)
  if (fill) doc.rect(LEFT, y, WIDTH, height).fill(fill)
  let x = LEFT
  row.texts.forEach((text, i) => {
    const width = layout.widths[i] - 2 * CELL_PAD_X
    write(doc, text, x + CELL_PAD_X, y + CELL_PAD_Y, width, { ...style, align: alignOf(layout.columns[i]) })
    const cell = row.cells?.[i] ?? null
    if (isShare(cell) && hasBar(cell, layout.columns[i])) shareBar(doc, cell, x + CELL_PAD_X, y + height - CELL_PAD_Y - SHARE_BAR_H, width)
    x += layout.widths[i]
  })
  rule(doc, y + height, RULE, 0.4)
  return height
}

function drawTableHead(ctx: Ctx, block: TableBlock, widths: readonly number[], continued: boolean) {
  if (continued) {
    write(ctx.doc, `${block.title} (continúa)`, LEFT, ctx.y, WIDTH, { size: 8, color: SOFT })
    ctx.y += 12
  }
  const head: Row = { texts: block.columns.map((column) => column.header), cells: null }
  ctx.y += drawRow(ctx.doc, ctx.y, head, { widths, columns: block.columns }, HEADER_CELL, HEAD_FILL)
}

function drawTable(ctx: Ctx, block: TableBlock) {
  const { doc } = ctx
  if (block.rows.length === 0) {
    blockTitle(ctx, block.title, block.description, 16)
    paragraph(ctx, block.empty, EMPTY, 12)
    return
  }
  const rows: Row[] = block.rows.map((cells) => ({ texts: block.columns.map((column, i) => cellText(cells[i], column)), cells }))
  const widths = columnWidths(doc, block.columns, rows)
  const layout = { widths, columns: block.columns }
  const head: Row = { texts: block.columns.map((column) => column.header), cells: null }
  const headHeight = rowHeight(doc, head, widths, block.columns, HEADER_CELL)
  const heights = rows.map((row) => rowHeight(doc, row, widths, block.columns, BODY_CELL))
  // Una tabla que entra en una hoja no se corta: si no entra en lo que queda, empieza en la siguiente.
  const whole = headHeight + sum(heights)
  blockTitle(ctx, block.title, block.description, whole <= (BOTTOM - TOP) * 0.8 ? whole : headHeight + heights[0])
  drawTableHead(ctx, block, widths, false)
  rows.forEach((row, index) => {
    const height = heights[index]
    if (ctx.y + height > BOTTOM) {
      doc.addPage()
      ctx.y = TOP
      drawTableHead(ctx, block, widths, true)
    }
    ctx.y += drawRow(doc, ctx.y, row, layout, BODY_CELL, index % 2 === 1 ? ZEBRA : undefined)
  })
  ctx.y += 14
}

// ─── Partes (barra segmentada) ──────────────────────────────────────────────

const SEGMENT_H = 12
const SWATCH = 7

const partColor = (part: Part, index: number) => (part.muted ? NO_DATA : PART_COLORS[index % PART_COLORS.length])

function legendText(part: Part, total: number): string {
  return `${part.label}: ${formatShare(part.value, total)}${part.alert ? ' (en alerta)' : ''}`
}

function legendRowHeights(doc: Doc, parts: readonly Part[], total: number, width: number): number[] {
  const heights: number[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const pair = parts.slice(i, i + 2).map((part) => measure(doc, legendText(part, total), width, LEGEND))
    heights.push(Math.max(...pair) + 3)
  }
  return heights
}

function drawParts(ctx: Ctx, block: PartsBlock) {
  const { doc } = ctx
  const total = block.parts.reduce((acc, part) => acc + part.value, 0)
  const columnWidth = WIDTH / 2
  const textWidth = columnWidth - SWATCH - 8
  const heights = legendRowHeights(doc, block.parts, total, textWidth)
  blockTitle(ctx, block.title, block.description, SEGMENT_H + 6 + heights.reduce((acc, h) => acc + h, 0))

  doc.rect(LEFT, ctx.y, WIDTH, SEGMENT_H).fill(TRACK)
  let x = LEFT
  block.parts.forEach((part, i) => {
    if (total <= 0 || part.value <= 0) return
    const width = (WIDTH * part.value) / total
    doc.rect(x, ctx.y, width, SEGMENT_H).fill(partColor(part, i))
    x += width
  })
  ctx.y += SEGMENT_H + 6

  block.parts.forEach((part, i) => {
    const rowIndex = Math.floor(i / 2)
    const y = ctx.y + heights.slice(0, rowIndex).reduce((acc, h) => acc + h, 0)
    const cx = LEFT + (i % 2) * columnWidth
    doc.rect(cx, y + 1.5, SWATCH, SWATCH).fill(partColor(part, i))
    write(doc, legendText(part, total), cx + SWATCH + 4, y, textWidth, { ...LEGEND, bold: Boolean(part.alert) })
  })
  ctx.y += heights.reduce((acc, h) => acc + h, 0) + 10
}

// ─── Barras verticales ──────────────────────────────────────────────────────

const CHART_H = 110

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

function drawBar(doc: Doc, block: BarsBlock, index: number, geometry: { slot: number; base: number }) {
  const bar = block.bars[index]
  const center = LEFT + geometry.slot * index + geometry.slot / 2
  const labelX = center - geometry.slot / 2
  const barWidth = Math.min(26, geometry.slot * 0.6)
  write(doc, bar.label, labelX, geometry.base + 3, geometry.slot, { size: 7, color: MUTED, align: 'center' })
  if (bar.value === null) {
    write(doc, '—', labelX, geometry.base - 11, geometry.slot, { size: 7, color: SOFT, align: 'center' })
    return
  }
  const range = block.max - block.min || 1
  const height = Math.max(1, clamp01((bar.value - block.min) / range) * CHART_H)
  doc.rect(center - barWidth / 2, geometry.base - height, barWidth, height).fill(BAR)
  write(doc, bar.text, labelX, geometry.base - height - 10, geometry.slot, { size: 6.5, color: INK, align: 'center' })
}

function drawBars(ctx: Ctx, block: BarsBlock) {
  if (block.bars.length === 0) return
  blockTitle(ctx, block.title, block.description, CHART_H + 34)
  const base = ctx.y + 12 + CHART_H
  const slot = WIDTH / block.bars.length
  rule(ctx.doc, base, '#94A3B8', 0.6)
  block.bars.forEach((_, index) => drawBar(ctx.doc, block, index, { slot, base }))
  ctx.y = base + 16
  if (block.axis) paragraph(ctx, block.axis, { size: 7.5, color: SOFT }, 4)
  ctx.y += 8
}

// ─── Notas ──────────────────────────────────────────────────────────────────

function drawNote(ctx: Ctx, block: NoteBlock) {
  if (block.title) blockTitle(ctx, block.title, undefined, 14)
  const bullet = block.lines.length > 1
  for (const line of block.lines) paragraph(ctx, bullet ? `•  ${line}` : line, NOTE, 3)
  ctx.y += 8
}

// ─── Hojas ──────────────────────────────────────────────────────────────────

function drawBlock(ctx: Ctx, block: Block) {
  switch (block.kind) {
    case 'table':
      return drawTable(ctx, block)
    case 'tiles':
      return drawTiles(ctx, block)
    case 'parts':
      return drawParts(ctx, block)
    case 'bars':
      return drawBars(ctx, block)
    default:
      return drawNote(ctx, block)
  }
}

function drawSection(ctx: Ctx, section: ReportSection, first: boolean) {
  if (!first) {
    ctx.doc.addPage()
    ctx.y = TOP
  }
  paragraph(ctx, section.title, SECTION, 3)
  rule(ctx.doc, ctx.y, ACCENT, 1)
  ctx.y += 8
  if (section.intro) paragraph(ctx, section.intro, INTRO, 10)
  for (const block of section.blocks) drawBlock(ctx, block)
}

function drawCover(ctx: Ctx, report: ReportDoc) {
  for (const filter of report.filters) paragraph(ctx, filter, FILTER, 1)
  if (report.sections.length > 1) paragraph(ctx, `Incluye: ${report.sections.map((s) => s.title).join(' · ')}.`, FILTER, 1)
  ctx.y += 14
}

function pageHeader(doc: Doc, report: ReportDoc, brand: Brand) {
  let x = LEFT
  if (brand.logo) {
    doc.image(brand.logo as unknown as Buffer, LEFT, HEADER_Y, { fit: [LOGO_SIZE, LOGO_SIZE], align: 'center', valign: 'center' })
    x += LOGO_SIZE + 10
  }
  const width = LEFT + WIDTH - x
  let y = HEADER_Y
  if (brand.name) {
    write(doc, brand.name, x, y, width, { size: 8.5, bold: true, color: MUTED })
    y += 12
  }
  write(doc, report.title, x, y, width, { size: 14, bold: true, color: ACCENT })
  y += 18
  write(doc, report.subtitle, x, y, width, { size: 9, color: MUTED })
  rule(doc, TOP - 16, RULE, 0.8)
}

function pageFooter(doc: Doc, report: ReportDoc, page: number, pages: number) {
  rule(doc, FOOTER_Y - 6)
  const pageWidth = 80
  write(doc, `Generado el ${formatDateTime(report.generatedAt)} · Contiene datos personales: sólo para uso interno.`, LEFT, FOOTER_Y, WIDTH - pageWidth, {
    size: 7,
    color: SOFT,
  })
  write(doc, `Página ${page} de ${pages}`, LEFT + WIDTH - pageWidth, FOOTER_Y, pageWidth, { size: 7, color: SOFT, align: 'right' })
}

/** Encabezado y pie en cada hoja, al final: recién ahí se sabe cuántas son. */
function decoratePages(doc: Doc, report: ReportDoc, brand: Brand) {
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    pageHeader(doc, report, brand)
    pageFooter(doc, report, i + 1, range.count)
  }
}

function openLogo(doc: Doc, bytes: Buffer | null): OpenedImage | null {
  if (!bytes) return null
  try {
    return (doc as unknown as { openImage(src: Buffer): OpenedImage }).openImage(bytes)
  } catch (error) {
    console.warn('[report-pdf] logo ilegible, se imprime sin él:', error)
    return null
  }
}

export function renderReportPdf(report: ReportDoc, institution: InstitutionBranding): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      // Debajo del pie: pdfkit nunca abre una hoja por su cuenta.
      margins: { top: HEADER_Y, bottom: 8, left: LEFT, right: LEFT },
      info: { Title: `${report.title} - ${report.subtitle}`, Author: institution.name ?? 'EduTrack', Creator: 'EduTrack' },
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try {
      const brand: Brand = { name: institution.name, logo: openLogo(doc, institution.logo) }
      const ctx: Ctx = { doc, y: TOP }
      drawCover(ctx, report)
      report.sections.forEach((section, i) => drawSection(ctx, section, i === 0))
      decoratePages(doc, report, brand)
      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}
