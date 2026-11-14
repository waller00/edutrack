/**
 * Un informe descargable, como datos: lo arman los indicadores (personal, estudiantes) y lo dibujan
 * `render-pdf.ts` y `render-xlsx.ts`. Así los dos informes y los dos formatos se ven iguales, y
 * cada sección se prueba sin abrir un PDF.
 *
 * Los números van con su base (`Share`): el informe, como la pantalla, nunca escribe un
 * porcentaje suelto.
 */

/** Una parte sobre un total: se escribe «34 de 88 (38,6 %)». */
export type Share = { part: number; total: number }

/** Lo que va en una celda; el tipo de la columna decide cómo se escribe. */
export type Cell = string | number | Share | null

/**
 * - `text`: tal cual.
 * - `count`: cantidad entera («1.034»).
 * - `decimal`: número con hasta `digits` decimales («7,5»); en el Excel queda como número.
 * - `share`: parte sobre total; en el Excel se abre en tres columnas (cantidad, total y %).
 * - `percent`: parte sobre total escrita sólo como «94,6 %», para tablas de muchas columnas (un
 *   curso por mes) cuya base dice la descripción; en el Excel, una columna de %.
 */
export type ColumnKind = 'text' | 'count' | 'decimal' | 'share' | 'percent'

export type Column = {
  header: string
  kind?: ColumnKind
  /** Decimales de una columna `decimal` (por defecto 1). */
  digits?: number
  /** Siempre con esos decimales, como la pantalla escribe un promedio («7,0»). */
  fixed?: boolean
  /** Ancho relativo en el PDF; por defecto, según el tipo. */
  weight?: number
}

export type TableBlock = {
  kind: 'table'
  title: string
  /** Nombre de su hoja en el Excel. */
  sheet: string
  description?: string
  columns: Column[]
  rows: Cell[][]
  /** Qué decir cuando no hay filas. */
  empty: string
  /** Un resumen de otra tabla del informe (los primeros de una lista): en el Excel no va. */
  pdfOnly?: boolean
}

export type Tile = { label: string; value: string; detail: string }

export type TilesBlock = { kind: 'tiles'; tiles: Tile[] }

/** `alert`: tramo en alerta (se dice en palabras, no sólo con color). `muted`: «sin dato», en gris. */
export type Part = { label: string; value: number; alert?: boolean; muted?: boolean }

/** Una barra dividida en partes que suman un total, con la leyenda de cada una. */
export type PartsBlock = {
  kind: 'parts'
  title: string
  description?: string
  parts: Part[]
}

export type Bar = { label: string; value: number | null; text: string }

/**
 * Barras verticales (p. ej. la asistencia de cada mes). Sólo se dibujan en el PDF: una gráfica
 * nunca es la única lectura, así que la sección trae además la tabla con los mismos números.
 */
export type BarsBlock = {
  kind: 'bars'
  title: string
  description?: string
  bars: Bar[]
  /** Escala del eje: de `min` a `max`. */
  min: number
  max: number
  /** Cómo leer la escala cuando no arranca en cero («Escala: de 80 % a 100 %»). */
  axis?: string
}

export type NoteBlock = { kind: 'note'; title?: string; lines: string[] }

export type Block = TableBlock | TilesBlock | PartsBlock | BarsBlock | NoteBlock

export type ReportSection = {
  id: string
  title: string
  intro?: string
  blocks: Block[]
}

export type ReportDoc = {
  title: string
  /** Una línea debajo del título: el período o el ciclo y el boletín. */
  subtitle: string
  /** Los filtros en palabras («Personas: Docentes»). */
  filters: string[]
  sections: ReportSection[]
  /** Nombre del archivo, sin extensión. */
  filename: string
  generatedAt: Date
}

export const isShare = (value: Cell): value is Share =>
  typeof value === 'object' && value !== null && 'part' in value && 'total' in value

export const share = (part: number, total: number): Share => ({ part, total })
