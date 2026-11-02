import { describe, it, expect, vi, afterEach } from 'vitest'
import { api } from './client'
import { NO_CONNECTION_MESSAGE, TOO_SLOW_MESSAGE } from './friendly-error'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('api()', () => {
  it('devuelve JSON en respuesta ok', async () => {
    mockFetch(() => new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    await expect(api<{ ok: number }>('/x')).resolves.toEqual({ ok: 1 })
  })

  it('error con message y detail del backend', async () => {
    mockFetch(() => new Response(JSON.stringify({ message: 'Falló', detail: 'por X' }), { status: 400 }))
    await expect(api('/x')).rejects.toMatchObject({ message: 'Falló — por X', status: 400 })
  })

  it('error sin cuerpo JSON → el mensaje del código, sin el número', async () => {
    mockFetch(() => new Response('no-json', { status: 500 }))
    await expect(api('/x')).rejects.toMatchObject({ message: 'Algo falló de nuestro lado. Probá de nuevo en un momento.', status: 500 })
  })

  it('AbortError → "tardó demasiado" y status 0', async () => {
    mockFetch(() => {
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(api('/x')).rejects.toMatchObject({ message: TOO_SLOW_MESSAGE, status: 0 })
  })

  it('error de red → "No hay conexión con EduTrack" y status 0', async () => {
    mockFetch(() => {
      throw new TypeError('network down')
    })
    await expect(api('/x')).rejects.toMatchObject({ message: NO_CONNECTION_MESSAGE, status: 0 })
  })
})
