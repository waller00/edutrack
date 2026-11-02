import { api, apiBaseUrl } from '@/lib/api/client'

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

  it('normaliza NEXT_PUBLIC_API_URL sin slash final', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://test.local///')

    expect(apiBaseUrl()).toBe('http://test.local')
  })

  it('no reintenta tras 401 (sesión Keycloak en el servidor)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/private')).rejects.toMatchObject({ message: 'expired', status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws an error using the backend message and status when available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'No autorizado', code: 'FORBIDDEN' }, 403))
    vi.stubGlobal('fetch', fetchMock)

    // "No autorizado" no dice qué hacer: se cambia por el mensaje del código, y `data` muestra lo mismo.
    await expect(api('/private')).rejects.toMatchObject({
      message: 'No tenés permiso para hacer esto.',
      status: 403,
      specific: false,
      data: { message: 'No tenés permiso para hacer esto.', code: 'FORBIDDEN' },
    })
  })

  it('agrega el detalle cuando el mensaje dice algo propio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'No se pudo guardar', detail: 'falta el correo' }, 400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/invalid')).rejects.toMatchObject({
      message: 'No se pudo guardar — falta el correo',
      status: 400,
      specific: true,
    })
  })

  it('un mensaje genérico no muestra el detalle técnico de la validación', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'Datos inválidos', detail: 'startsOn: Invalid date' }, 400))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/invalid')).rejects.toMatchObject({
      message: 'Revisá los datos: hay algo incompleto o mal escrito.',
      status: 400,
    })
  })

  it('un detalle que no es texto (un objeto) no se muestra', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'Hay secciones observadas', detail: { blockingSections: ['GRADES'] } }, 409))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/x')).rejects.toMatchObject({ message: 'Hay secciones observadas', status: 409 })
  })

  it('sin un cuerpo que explique, dice qué pasó en palabras comunes, sin códigos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('server exploded', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/broken')).rejects.toMatchObject({
      message: 'Algo falló de nuestro lado. Probá de nuevo en un momento.',
      status: 500,
      specific: false,
    })
  })

  it('"Error interno del servidor" tampoco llega a la pantalla', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'Error interno del servidor' }, 500))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/z')).rejects.toMatchObject({ message: 'Algo falló de nuestro lado. Probá de nuevo en un momento.' })
  })

  it('acepta 204 sin cuerpo (DELETE)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api('/gone', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
