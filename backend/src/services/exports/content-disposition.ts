/**
 * Cabecera `Content-Disposition` con nombres de archivo que tienen acentos.
 *
 * Las cabeceras HTTP viajan en latin-1, así que poner `filename="Díaz.pdf"` a secas llega al
 * navegador como `Dýaz.pdf`. En un liceo uruguayo eso no es un caso de borde: pasa con cualquier
 * apellido con tilde o con ñ.
 *
 * La solución del RFC 5987/6266 es mandar las dos formas: un `filename` ASCII como respaldo para
 * clientes viejos, y un `filename*` en UTF-8 percent-encoded que los navegadores actuales prefieren.
 */

/** Quita acentos y todo lo que no sea ASCII imprimible, para el respaldo. */
function toAscii(filename: string): string {
  return filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    // Las comillas y las barras romperían el valor entre comillas de la cabecera.
    .replace(/["\\]/g, '_')
}

export function attachmentDisposition(filename: string): string {
  const ascii = toAscii(filename)
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
