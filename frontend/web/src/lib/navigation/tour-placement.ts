/**
 * Dónde va el globo del onboarding respecto del control que señala.
 *
 * Prueba abajo, arriba, a la derecha y a la izquierda, en ese orden, y nunca se sale de la
 * ventana. En una pantalla angosta no hay lado que alcance: el globo va como hoja fija abajo
 * (`dock`) y el control sigue resaltado donde está.
 */

export type Rect = { top: number; left: number; width: number; height: number }
export type Size = { width: number; height: number }
export type Side = 'bottom' | 'top' | 'right' | 'left' | 'dock'
export type Placement = { top: number; left: number; side: Side }

/** Por debajo de este ancho (el `sm` de Tailwind) el globo va abajo, como hoja fija. */
export const DOCK_BELOW = 640
/** Distancia mínima a los bordes de la ventana. */
export const EDGE = 12

function clamp(value: number, min: number, max: number): number {
  // Un globo más grande que la ventana queda pegado al borde de arriba o de la izquierda.
  return max < min ? min : Math.min(Math.max(value, min), max)
}

export function placePopover(anchor: Rect, size: Size, viewport: Size, gap = 12): Placement {
  if (viewport.width < DOCK_BELOW) {
    return { side: 'dock', top: Math.max(EDGE, viewport.height - size.height - EDGE), left: EDGE }
  }
  const maxLeft = viewport.width - size.width - EDGE
  const maxTop = viewport.height - size.height - EDGE
  const centeredLeft = clamp(anchor.left + anchor.width / 2 - size.width / 2, EDGE, maxLeft)
  const centeredTop = clamp(anchor.top + anchor.height / 2 - size.height / 2, EDGE, maxTop)

  const below = anchor.top + anchor.height + gap
  if (below <= maxTop) return { side: 'bottom', top: below, left: centeredLeft }
  const above = anchor.top - gap - size.height
  if (above >= EDGE) return { side: 'top', top: above, left: centeredLeft }
  const right = anchor.left + anchor.width + gap
  if (right <= maxLeft) return { side: 'right', top: centeredTop, left: right }
  const left = anchor.left - gap - size.width
  if (left >= EDGE) return { side: 'left', top: centeredTop, left }
  // El control ocupa toda la ventana (una tabla larga): el globo va encima, abajo a la derecha.
  return { side: 'bottom', top: clamp(maxTop, EDGE, maxTop), left: clamp(maxLeft, EDGE, maxLeft) }
}
