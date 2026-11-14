/**
 * Saca del final de `value` todos los caracteres que estén en `chars`.
 *
 * Es lo que hacía `replace(/\/+$/, "")` sin la regex: con muchos de esos caracteres seguidos que no
 * llegan al final ("////a"), el motor reintenta desde cada uno y tarda en proporción al cuadrado del
 * largo. Acá es una sola pasada desde el final.
 */
export function trimEndChars(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1])) end--;
  return value.slice(0, end);
}

/**
 * Orden por unidades de código UTF-16: el mismo de `sort()` sin comparador, pero escrito.
 *
 * Para claves, ids y fechas `YYYY-MM-DD`, donde lo que importa es un orden fijo y no el alfabético
 * del idioma (`localeCompare` cambia según la configuración regional y no sirve para claves que se
 * guardan, como la de una conversación).
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
