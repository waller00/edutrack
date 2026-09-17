import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiBlob, apiUpload } from './binary'

vi.mock('@/lib/api/base-url', () => ({ apiBaseUrl: () => 'http://api.test' }))

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

describe('apiBlob', () => {
  it('manda la cookie de sesión y devuelve el blob', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: async () => blob } as unknown as Response)

    const result = await apiBlob('/admin/students/s1/photo')

    expect(result).toBe(blob)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/admin/students/s1/photo',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('un 404 es "no hay foto", no un error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { message: 'sin foto' }))
    await expect(apiBlob('/admin/students/s1/photo')).resolves.toBeNull()
  })

  it('propaga el mensaje del backend con su status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Sin permiso' }))
    await expect(apiBlob('/x')).rejects.toMatchObject({ message: 'Sin permiso', status: 403 })
  })

  it('no se rompe si el error no viene en JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('no es JSON')
      },
    } as unknown as Response)

    await expect(apiBlob('/x')).rejects.toMatchObject({ message: 'API 502', status: 502 })
  })
})

describe('apiUpload', () => {
  it('manda el archivo con su tipo real, sin base64', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })

    await apiUpload('/admin/students/s1/photo', file)

    const init = fetchMock.mock.calls[0][1]
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('image/jpeg')
    expect(init.body).toBe(file)
    expect(init.credentials).toBe('include')
  })

  it('propaga el 413 con el mensaje del backend', async () => {
    fetchMock.mockResolvedValue(jsonResponse(413, { message: 'La foto supera 1 MB.' }))
    const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })

    await expect(apiUpload('/x', file)).rejects.toMatchObject({
      message: 'La foto supera 1 MB.',
      status: 413,
    })
  })
})
