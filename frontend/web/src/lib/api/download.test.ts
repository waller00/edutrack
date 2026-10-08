import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFile, filenameFromDisposition } from './download'

vi.mock('@/lib/api/client', () => ({ apiBaseUrl: () => 'http://api.test' }))

describe('filenameFromDisposition', () => {
  it('prefiere filename* para conservar las tildes', () => {
    const header = `attachment; filename="boletin-Diaz-Ana.pdf"; filename*=UTF-8${"''"}boletin-D%C3%ADaz-Ana.pdf`
    expect(filenameFromDisposition(header, 'x.pdf')).toBe('boletin-Díaz-Ana.pdf')
  })

  it('cae al nombre ASCII y después al de respaldo', () => {
    expect(filenameFromDisposition('attachment; filename="libreta.xlsx"', 'x')).toBe('libreta.xlsx')
    expect(filenameFromDisposition(`attachment; filename*=UTF-8${"''"}%E0%A4%A`, 'respaldo.pdf')).toBe('respaldo.pdf')
    expect(filenameFromDisposition(null, 'respaldo.pdf')).toBe('respaldo.pdf')
  })
})

describe('downloadFile', () => {
  const click = vi.fn()

  beforeEach(() => {
    click.mockReset()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'a') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      return { href: '', download: '', click } as unknown as HTMLElement
    }) as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('descarga con la cookie de sesión y el nombre del servidor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['%PDF']),
      headers: { get: () => 'attachment; filename="boletines.pdf"' },
    })
    globalThis.fetch = fetchMock as never

    await downloadFile('/admin/gradebook/report-cards?x=1', 'respaldo.pdf')

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/admin/gradebook/report-cards?x=1', {
      credentials: 'include',
      cache: 'no-store',
    })
    expect(click).toHaveBeenCalled()
  })

  it('muestra el mensaje del servidor si la descarga falla', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'El período no corresponde a ese grupo' }),
    }) as never
    await expect(downloadFile('/x', 'x.pdf')).rejects.toThrow('El período no corresponde a ese grupo')
  })

  it('sin permiso lo dice en castellano', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }) as never
    await expect(downloadFile('/x', 'x.pdf')).rejects.toThrow('No tenés permiso')
  })
})
