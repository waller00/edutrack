import ExcelJS from 'exceljs'
import type { InstitutionBranding } from '../institution-branding.js'
import { addNoDataRow, formatWorksheetForExport } from '../analytics/exports/excel-format.js'
import { formatDateTime, formatShare } from './format.js'
import { isShare, type Cell, type Column, type NoteBlock, type PartsBlock, type ReportDoc, type ReportSection, type TableBlock, type TilesBlock } from './model.js'

/**
 * Un informe en Excel: la hoja "Resumen" con los mosaicos, las partes y las notas de cada sección,
 * y una hoja por tabla para trabajar los números (con filtros y encabezado fijo).
 *
 * Una columna con parte sobre total se abre en tres: la cantidad, el total y el %, como número:
 * así se puede ordenar y sumar. Las barras verticales del PDF no van: sus números están en su tabla.
 */

const PERCENT_FORMAT = '0.0%'
const TITLE_FILL = 'FFE8EEF5'
const MAX_SHEET_NAME = 31

/** Nombres de hoja válidos para Excel (sin `\ / ? * [ ] :`, hasta 31 letras) y sin repetir. */
export class SheetNames {
  private readonly used = new Set<string>()

  take(name: string): string {
    const clean = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Hoja'
    let candidate = clean.slice(0, MAX_SHEET_NAME)
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`
      candidate = `${clean.slice(0, MAX_SHEET_NAME - suffix.length)}${suffix}`
    }
    this.used.add(candidate.toLowerCase())
    return candidate
  }
}

// ─── Hojas de tablas ────────────────────────────────────────────────────────

/** Los encabezados de la hoja: una columna con parte y total ocupa tres. */
export function sheetHeaders(columns: readonly Column[]): string[] {
  return columns.flatMap((column) =>
    column.kind === 'share' ? [column.header, `${column.header} (total)`, `${column.header} (%)`] : [column.header],
  )
}

const fraction = (part: number, total: number) => (total > 0 ? part / total : null)

function shareValues(cell: Cell | undefined): (number | null)[] {
  if (!isShare(cell ?? null)) return [null, null, null]
  const { part, total } = cell as { part: number; total: number }
  return [part, total, fraction(part, total)]
}

function percentValue(cell: Cell | undefined): number | null {
  if (!isShare(cell ?? null)) return null
  const { part, total } = cell as { part: number; total: number }
  return fraction(part, total)
}

/** Los valores de una fila, en el orden de `sheetHeaders`. */
export function sheetRow(columns: readonly Column[], cells: readonly (Cell | undefined)[]): (string | number | null)[] {
  return columns.flatMap((column, i) => {
    const cell = cells[i]
    if (column.kind === 'share') return shareValues(cell)
    if (column.kind === 'percent') return [percentValue(cell)]
    if (cell === undefined || cell === null || isShare(cell)) return [null]
    return [cell]
  })
}

/** El formato de número de cada columna de la hoja (contadas desde 1). */
export function numberFormats(columns: readonly Column[]): Map<number, string> {
  const formats = new Map<number, string>()
  let position = 0
  for (const column of columns) {
    if (column.kind === 'share') {
      formats.set(position + 3, PERCENT_FORMAT)
      position += 3
      continue
    }
    position += 1
    if (column.kind === 'percent') formats.set(position, PERCENT_FORMAT)
    if (column.kind === 'decimal' && column.fixed) formats.set(position, `0.${'0'.repeat(column.digits ?? 1)}`)
  }
  return formats
}

function writeTableSheet(sheet: ExcelJS.Worksheet, block: TableBlock) {
  const headers = sheetHeaders(block.columns)
  sheet.addRow(headers)
  for (const cells of block.rows) sheet.addRow(sheetRow(block.columns, cells))
  if (block.rows.length === 0) addNoDataRow(sheet, headers.length, block.empty)
  for (const [index, format] of numberFormats(block.columns)) sheet.getColumn(index).numFmt = format
  formatWorksheetForExport(sheet, { headerRow: 1, maxWidth: 44 })
}

// ─── Hoja "Resumen" ─────────────────────────────────────────────────────────

function heading(sheet: ExcelJS.Worksheet, text: string, size = 12) {
  const row = sheet.addRow([text])
  row.font = { bold: true, size }
  return row
}

function labelRow(sheet: ExcelJS.Worksheet, values: (string | number | null)[]) {
  const row = sheet.addRow(values)
  row.font = { bold: true, color: { argb: 'FF475569' } }
  return row
}

function writeTiles(sheet: ExcelJS.Worksheet, block: TilesBlock) {
  labelRow(sheet, ['Indicador', 'Valor', 'Detalle'])
  for (const tile of block.tiles) sheet.addRow([tile.label, tile.value, tile.detail])
}

function writeParts(sheet: ExcelJS.Worksheet, block: PartsBlock) {
  const total = block.parts.reduce((acc, part) => acc + part.value, 0)
  heading(sheet, block.title, 11)
  if (block.description) sheet.addRow([block.description])
  labelRow(sheet, ['', 'Cantidad', 'Detalle', 'Total', '%'])
  for (const part of block.parts) {
    const row = sheet.addRow([
      part.alert ? `${part.label} (en alerta)` : part.label,
      part.value,
      formatShare(part.value, total),
      total,
      total > 0 ? part.value / total : null,
    ])
    row.getCell(5).numFmt = PERCENT_FORMAT
  }
}

function writeNote(sheet: ExcelJS.Worksheet, block: NoteBlock) {
  if (block.title) heading(sheet, block.title, 11)
  for (const line of block.lines) sheet.addRow([line])
}

function writeSection(sheet: ExcelJS.Worksheet, section: ReportSection, tableSheets: Map<TableBlock, string>) {
  const title = heading(sheet, section.title, 13)
  title.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } }
  if (section.intro) sheet.addRow([section.intro])
  for (const block of section.blocks) {
    if (block.kind === 'tiles') writeTiles(sheet, block)
    else if (block.kind === 'parts') writeParts(sheet, block)
    else if (block.kind === 'note') writeNote(sheet, block)
    else if (block.kind === 'table' && tableSheets.has(block)) sheet.addRow([`${block.title}: en la hoja «${tableSheets.get(block)}».`])
    sheet.addRow([])
  }
}

function writeSummary(sheet: ExcelJS.Worksheet, report: ReportDoc, institution: InstitutionBranding, tableSheets: Map<TableBlock, string>) {
  if (institution.name) heading(sheet, institution.name, 11)
  heading(sheet, report.title, 15)
  sheet.addRow([report.subtitle])
  sheet.addRow([`Generado el ${formatDateTime(report.generatedAt)}. Contiene datos personales: sólo para uso interno.`])
  for (const filter of report.filters) sheet.addRow([filter])
  sheet.addRow([])
  for (const section of report.sections) writeSection(sheet, section, tableSheets)
  sheet.columns = [{ width: 48 }, { width: 22 }, { width: 70 }, { width: 12 }, { width: 10 }]
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true }
  })
}

export async function renderReportXlsx(report: ReportDoc, institution: InstitutionBranding): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = institution.name ?? 'EduTrack'
  workbook.created = report.generatedAt
  const names = new SheetNames()
  const summary = workbook.addWorksheet(names.take('Resumen'))

  const tables = report.sections.flatMap((section) => section.blocks.filter((block): block is TableBlock => block.kind === 'table' && !block.pdfOnly))
  const tableSheets = new Map(tables.map((table) => [table, names.take(table.sheet)] as const))
  writeSummary(summary, report, institution, tableSheets)
  for (const [table, name] of tableSheets) writeTableSheet(workbook.addWorksheet(name), table)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
