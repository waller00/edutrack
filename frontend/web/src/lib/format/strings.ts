/**
 * Saca del final de `value` todos los caracteres que estén en `chars`.
 *
 * Reemplaza a `replace(/\/+$/, '')`: con muchos de esos caracteres seguidos que no llegan al final,
 * la regex reintenta desde cada uno y tarda en proporción al cuadrado del largo.
 */
export function trimEndChars(value: string, chars: string): string {
  let end = value.length
  while (end > 0 && chars.includes(value[end - 1])) end--
  return value.slice(0, end)
}

/** Orden por unidades de código UTF-16: el mismo de `sort()` sin comparador, pero escrito. */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
