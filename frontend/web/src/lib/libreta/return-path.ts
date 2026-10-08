/**
 * Ruta de regreso que viene en la URL (`?volver=`). Sólo se aceptan rutas internas de la libreta:
 * un `?volver=https://…` o `//otro-sitio` no puede convertir el enlace "volver" en una redirección
 * a cualquier lado.
 */
export function safeReturnPath(value: string | string[] | null | undefined, fallback: string): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw || !raw.startsWith('/libreta/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  return raw
}
