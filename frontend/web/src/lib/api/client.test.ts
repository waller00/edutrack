import { api } from '@/lib/api/client'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://test.local')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('calls fetch with project defaults and returns parsed json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/health')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith('http://test.local/health', expect.objectContaining({
      credentials: 'include',
      cache: 'no-store',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
  })

  it('refreshes once after a 401 and retries the original request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({}, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/private')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://test.local/auth/refresh', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws an error using the backend message and status when available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'No autorizado', code: 'FORBIDDEN' }, 403))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/private')).rejects.toMatchObject({
      message: 'No autorizado',
      status: 403,
      data: { message: 'No autorizado', code: 'FORBIDDEN' },
    })
  })

  it('includes backend detail in the error message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'Datos inválidos', detail: 'email requerido' }, 400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/invalid')).rejects.toMatchObject({
      message: 'Datos inválidos — email requerido',
      status: 400,
    })
  })

  it('throws a fallback API status error when the body is not valid json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('server exploded', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/broken')).rejects.toMatchObject({
      message: 'API 500',
      status: 500,
    })
  })

  it('no reintenta si el refresh tras 401 no es ok', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Sesión expirada' }, 401))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/x')).rejects.toMatchObject({
      message: 'Sesión expirada',
      status: 401,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tras refresh ok, falla con el error del segundo intento', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Prohibido' }, 403))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/y')).rejects.toMatchObject({
      message: 'Prohibido',
      status: 403,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('usa API {status} cuando el JSON de error no trae message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 422))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/z')).rejects.toMatchObject({
      message: 'API 422',
      status: 422,
    })
  })
})
