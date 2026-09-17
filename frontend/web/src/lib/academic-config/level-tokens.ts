import type { ScaleLevel } from './types'

/**
 * Estilo de un nivel de escala.
 *
 * **RNF 7.2:** el semáforo académico no puede depender exclusivamente del color. Por eso cada
 * nivel resuelve siempre un `symbol` textual además de las clases: quien no distinga los colores,
 * navegue con lector de pantalla o imprima en blanco y negro tiene que poder leer el nivel igual.
 * Las clases son literales completos porque Tailwind purga las construidas por concatenación.
 */

export type LevelStyle = {
  badgeClass: string
  dotClass: string
  /** Símbolo corto que acompaña al color; nunca vacío. */
  symbol: string
}

const STYLES: Record<string, LevelStyle> = {
  red: { badgeClass: 'bg-red-50 text-red-800 border-red-200', dotClass: 'bg-red-500', symbol: '▲' },
  amber: { badgeClass: 'bg-amber-50 text-amber-900 border-amber-200', dotClass: 'bg-amber-500', symbol: '●' },
  green: { badgeClass: 'bg-green-50 text-green-800 border-green-200', dotClass: 'bg-green-500', symbol: '✓' },
  emerald: { badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200', dotClass: 'bg-emerald-500', symbol: '★' },
  blue: { badgeClass: 'bg-blue-50 text-blue-800 border-blue-200', dotClass: 'bg-blue-500', symbol: '◆' },
}

const NEUTRAL: LevelStyle = {
  badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
  dotClass: 'bg-gray-400',
  symbol: '•',
}

/** Símbolos por `iconToken`, para que el dato del backend mande sobre el color. */
const ICON_SYMBOLS: Record<string, string> = {
  'alert-triangle': '▲',
  'alert-circle': '●',
  check: '✓',
  star: '★',
}

export function levelStyle(level: Pick<ScaleLevel, 'colorToken' | 'iconToken'>): LevelStyle {
  const base = (level.colorToken && STYLES[level.colorToken]) || NEUTRAL
  const symbol = (level.iconToken && ICON_SYMBOLS[level.iconToken]) || base.symbol
  return { ...base, symbol }
}

/** Texto alternativo del nivel, para `title`/`aria-label` cuando sólo se muestra el badge. */
export function levelAccessibleText(level: Pick<ScaleLevel, 'label' | 'descriptor' | 'isAlert'>): string {
  const parts = [level.label]
  if (level.isAlert) parts.push('situación de alerta')
  if (level.descriptor) parts.push(level.descriptor)
  return parts.join(' — ')
}
