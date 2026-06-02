import { describe, it, expect, vi, afterEach } from 'vitest'
import { api } from './client'

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

  it('error sin cuerpo JSON → "API <status>"', async () => {
    mockFetch(() => new Response('no-json', { status: 500 }))
    await expect(api('/x')).rejects.toMatchObject({ message: 'API 500', status: 500 })
  })

  it('AbortError → "API sin respuesta" y status 0', async () => {
    mockFetch(() => {
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(api('/x')).rejects.toMatchObject({ message: 'API sin respuesta', status: 0 })
  })

  it('error de red → "No se pudo conectar con la API" y status 0', async () => {
    mockFetch(() => {
      throw new TypeError('network down')
    })
    await expect(api('/x')).rejects.toMatchObject({ message: 'No se pudo conectar con la API', status: 0 })
  })
})
