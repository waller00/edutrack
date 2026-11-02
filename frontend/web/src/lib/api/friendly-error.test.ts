import { describe, expect, it } from 'vitest'
import { friendlyMessage, isSpecificMessage, statusMessage } from './friendly-error'

describe('mensajes de error para quien usa la pantalla', () => {
  it('lo que el sistema explica pasa tal cual', () => {
    expect(friendlyMessage('El período no está cerrado.', 409)).toBe('El período no está cerrado.')
  })

  it('los genéricos y los códigos sueltos se cambian por el del código', () => {
    for (const generic of ['Error interno del servidor', 'Datos inválidos', 'No autorizado', 'Token inválido', 'API 500', '500', 'HTTP 404']) {
      expect(isSpecificMessage(generic), generic).toBe(false)
    }
    expect(friendlyMessage('Error interno del servidor', 500)).toBe('Algo falló de nuestro lado. Probá de nuevo en un momento.')
    expect(friendlyMessage(undefined, 404)).toBe('No encontramos lo que buscabas: puede que se haya borrado.')
  })

  it('ningún mensaje del código habla de API, servidor ni números', () => {
    for (const status of [0, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 418]) {
      expect(statusMessage(status), String(status)).not.toMatch(/API|servidor|HTTP|\d{3}/i)
    }
  })
})
