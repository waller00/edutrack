import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExportButtons from './ExportButtons'

vi.mock('@/lib/api/client', () => ({ apiBaseUrl: () => 'http://api.test' }))

const clickSpy = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  clickSpy.mockReset()
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
  globalThis.URL.revokeObjectURL = vi.fn()
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'a') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
    return { href: '', download: '', click: clickSpy } as unknown as HTMLElement
  }) as never)
})

function mockFetch(ok = true, filename = 'matematica-3-ems.xlsx') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    blob: async () => new Blob(['x']),
    headers: { get: () => `attachment; filename="${filename}"` },
  })
  globalThis.fetch = fetchMock as never
  return fetchMock
}

describe('ExportButtons', () => {
  it('manda la cookie de sesión: la API vive en otro origen', async () => {
    const fetchMock = mockFetch()
    render(<ExportButtons gradeBookId="gb-1" />)

    fireEvent.click(screen.getByRole('button', { name: /Excel/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://api.test/gradebook/gb-1/exports/xlsx',
        expect.objectContaining({ credentials: 'include' }),
      )
    })
  })

  it('usa el nombre de archivo que manda el servidor', async () => {
    mockFetch(true, 'benitez-ana-matematica.pdf')
    render(<ExportButtons gradeBookId="gb-1" />)

    fireEvent.click(screen.getByRole('button', { name: /PDF/ }))
    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
  })

  it('informa el error en vez de descargar un archivo roto', async () => {
    mockFetch(false)
    render(<ExportButtons gradeBookId="gb-1" />)

    fireEvent.click(screen.getByRole('button', { name: /Excel/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar')
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('ofrece las dos exportaciones', () => {
    mockFetch()
    render(<ExportButtons gradeBookId="gb-1" />)
    expect(screen.getByRole('button', { name: /Excel de calificaciones y cierres/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PDF de la libreta/ })).toBeInTheDocument()
  })
})
