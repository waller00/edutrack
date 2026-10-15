/** Lo que Excel y LibreOffice interpretan como fórmula al abrir un CSV. */
const FORMULA_START = /^[=+\-@\t\r]/
/** Un número negativo o con decimales sí puede empezar con "-": no es una fórmula. */
const NUMBER = /^-?\d+(?:[.,]\d+)?$/

/**
 * Celda de CSV escapada.
 *
 * Además del entrecomillado, neutraliza la inyección de fórmulas: un nombre como
 * `=HYPERLINK("http://…")`, cargado por la persona al registrarse, se ejecutaba en el Excel de
 * quien bajaba la liquidación. Se antepone un apóstrofo, que Excel muestra como texto.
 */
export function csvCell(value: unknown, separator: ',' | ';'): string {
  let s = String(value ?? '')
  if (FORMULA_START.test(s) && !NUMBER.test(s)) s = `'${s}`
  if (s.includes('"') || s.includes(separator) || /[\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}
