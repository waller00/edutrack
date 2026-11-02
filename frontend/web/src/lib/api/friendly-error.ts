/**
 * Los errores, en palabras de quien usa la pantalla: nunca "API 500", "servidor" ni un código.
 *
 * Lo que el sistema ya explica en castellano ("El período no está cerrado") pasa tal cual. Los
 * mensajes genéricos, que no dicen qué pasó ni qué hacer, se cambian por uno según el código de la
 * respuesta.
 */

export const NO_CONNECTION_MESSAGE = 'No hay conexión con EduTrack. Revisá tu internet y probá de nuevo.'
export const TOO_SLOW_MESSAGE = 'EduTrack tardó demasiado en responder. Probá de nuevo en un momento.'

/** Qué decirle a la persona según el código, cuando la respuesta no trae nada mejor. */
export function statusMessage(status: number): string {
  if (status === 0) return NO_CONNECTION_MESSAGE
  if (status === 400 || status === 422) return 'Revisá los datos: hay algo incompleto o mal escrito.'
  if (status === 401) return 'Tu sesión terminó. Volvé a ingresar.'
  if (status === 403) return 'No tenés permiso para hacer esto.'
  if (status === 404) return 'No encontramos lo que buscabas: puede que se haya borrado.'
  if (status === 409) return 'Esto cambió mientras tanto. Actualizá la pantalla y probá de nuevo.'
  if (status === 413) return 'El archivo es demasiado grande.'
  if (status === 429) return 'Hubo demasiados intentos seguidos. Esperá un momento y probá de nuevo.'
  if (status >= 500) return 'Algo falló de nuestro lado. Probá de nuevo en un momento.'
  return 'No se pudo completar la acción. Probá de nuevo.'
}

/** Mensajes que no le dicen nada a quien usa la pantalla: se cambian por el del código. */
const GENERIC_MESSAGES = new Set(
  [
    'Error interno del servidor',
    'Datos inválidos',
    'Parámetros inválidos',
    'No autorizado',
    'Prohibido',
    'Token inválido',
    'Internal Server Error',
    'Bad Request',
    'Unauthorized',
    'Forbidden',
    'Not Found',
  ].map((text) => text.toLowerCase()),
)

/** ¿El mensaje dice algo propio, o es genérico (o un código suelto, "API 500")? */
export function isSpecificMessage(message: unknown): message is string {
  if (typeof message !== 'string') return false
  const text = message.trim()
  if (!text || GENERIC_MESSAGES.has(text.toLowerCase())) return false
  return !/^(api|http)?\s*\d{3}$/i.test(text)
}

/** El mensaje que se muestra: el propio de la respuesta si dice algo, si no el del código. */
export function friendlyMessage(message: unknown, status: number): string {
  return isSpecificMessage(message) ? message.trim() : statusMessage(status)
}
