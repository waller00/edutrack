import type ExcelJS from 'exceljs'

type HeaderStyle = {
  fill?: string
  font?: ExcelJS.Font
}

type FormatWorksheetOptions = {
  headerRow?: number
  minWidth?: number
  maxWidth?: number
  wrapText?: boolean
  freezeHeader?: boolean
  autoFilter?: boolean
  headerStyle?: HeaderStyle
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const cellValue = value as any
    if (cellValue.text) return String(cellValue.text)
    if (cellValue.result !== undefined) return stringValue(cellValue.result)
    if (cellValue.richText) return cellValue.richText.map((r: any) => r.text ?? '').join('')
    return JSON.stringify(value)
  }
  return String(value)
}

function getColumn(sheet: ExcelJS.Worksheet, colNumber: number): any {
  const maybeSheet = sheet as any
  if (typeof maybeSheet.getColumn === 'function') return maybeSheet.getColumn(colNumber)
  maybeSheet.columns ||= []
  maybeSheet.columns[colNumber - 1] ||= {}
  return maybeSheet.columns[colNumber - 1]
}

function getColumnCount(sheet: ExcelJS.Worksheet) {
  const explicit = sheet.columns?.length || 0
  const actual = (sheet as any).actualColumnCount || 0
  let fromRows = 0
  sheet.eachRow((row) => {
    const values = Array.isArray(row.values) ? row.values : []
    const valueCount = values.length > 0 && values[0] === undefined ? values.length - 1 : values.length
    fromRows = Math.max(fromRows, (row as any).cellCount || valueCount || 0)
  })
  return Math.max(explicit, actual, fromRows)
}

function estimateRowHeight(row: ExcelJS.Row, widths: number[], minHeight = 18) {
  let maxLines = 1
  for (let colNumber = 1; colNumber <= widths.length; colNumber += 1) {
    const text = stringValue(row.getCell(colNumber).value)
    if (!text) continue
    const hardLines = text.split(/\r\n|\n|\r/)
    const width = Math.max(widths[colNumber - 1] || 12, 8)
    const softLines = hardLines.reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / width)), 0)
    maxLines = Math.max(maxLines, softLines)
  }
  return Math.min(96, Math.max(minHeight, 16 + maxLines * 10))
}

export function formatWorksheetForExport(sheet: ExcelJS.Worksheet, options: FormatWorksheetOptions = {}) {
  const headerRowNumber = options.headerRow ?? 1
  const minWidth = options.minWidth ?? 10
  const maxWidth = options.maxWidth ?? 42
  const wrapText = options.wrapText ?? true
  const columnCount = getColumnCount(sheet)
  const widths: number[] = []

  for (let colNumber = 1; colNumber <= columnCount; colNumber += 1) {
    let maxLength = 0
    sheet.eachRow((row) => {
      const text = stringValue(row.getCell(colNumber).value)
      for (const line of text.split(/\r\n|\n|\r/)) {
        maxLength = Math.max(maxLength, line.length)
      }
    })
    const width = Math.min(maxWidth, Math.max(minWidth, Math.ceil(maxLength * 1.08) + 2))
    widths[colNumber - 1] = width
    getColumn(sheet, colNumber).width = width
  }

  sheet.eachRow((row) => {
    row.height = row.number === headerRowNumber ? 22 : estimateRowHeight(row, widths)
    for (let colNumber = 1; colNumber <= columnCount; colNumber += 1) {
      const cell = row.getCell(colNumber)
      cell.alignment = { ...(cell.alignment || {}), vertical: 'top', wrapText }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
    }
  })

  const headerRow = sheet.getRow(headerRowNumber)
  headerRow.eachCell((cell) => {
    cell.font = options.headerStyle?.font || { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: options.headerStyle?.fill || 'FF1F4E79' },
    }
    cell.alignment = { ...(cell.alignment || {}), horizontal: 'center', vertical: 'middle', wrapText: true }
  })

  if (options.freezeHeader ?? true) {
    sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }]
  }

  if ((options.autoFilter ?? true) && sheet.lastRow && sheet.lastRow.number >= headerRowNumber) {
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: Math.max(1, columnCount) },
    }
  }
}

export function addNoDataRow(sheet: ExcelJS.Worksheet, colCount: number, message = 'No hay datos para los filtros seleccionados') {
  const row = sheet.addRow([message, ...new Array(Math.max(0, colCount - 1)).fill('')])
  row.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } }
  return row
}
