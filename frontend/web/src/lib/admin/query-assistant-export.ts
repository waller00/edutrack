export type AssistantColumn = { key: string; label: string }
export type AssistantRow = Record<string, string | number | null>

/** Normaliza una celda para TSV: vacío como cadena vacía y sin tabs/saltos que rompan el formato. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[\t\r\n]+/g, ' ').trim()
}

/** Convierte el resultado del asistente a texto TSV (encabezado + filas), apto para pegar en una planilla. */
export function rowsToTsv(columns: AssistantColumn[], rows: AssistantRow[]): string {
  if (columns.length === 0) return ''
  const header = columns.map((c) => cell(c.label)).join('\t')
  const body = rows.map((row) => columns.map((c) => cell(row[c.key])).join('\t'))
  return [header, ...body].join('\n')
}
