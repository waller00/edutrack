import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentAccommodationsPanel from './StudentAccommodationsPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const ROW = {
  id: 'ad-1',
  kind: 'EVALUATION',
  summary: 'Más tiempo en las pruebas escritas.',
  externalUrl: 'https://drive.example/informe',
  validFrom: null,
  validUntil: '2026-12-01T12:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.mockResolvedValue({ data: [] })
})

describe('<StudentAccommodationsPanel />', () => {
  it('deja claro que el informe no se sube', async () => {
    // Es la regla que protege datos de salud de un menor: acá va el enlace, no el documento.
    render(<StudentAccommodationsPanel studentId="s1" />)
    expect(await screen.findByText(/El informe no se sube al sistema/)).toBeInTheDocument()
    expect(screen.getByText(/no el diagnóstico/)).toBeInTheDocument()
  })

  it('lista las adecuaciones cargadas', async () => {
    mockedApi.mockResolvedValue({ data: [ROW] })

    render(<StudentAccommodationsPanel studentId="s1" />)

    // Acotado a la lista: "Adecuación de evaluación" también es una opción del selector de alta.
    const item = (await screen.findByText('Más tiempo en las pruebas escritas.')).closest('li')!
    expect(within(item).getByText('Adecuación de evaluación')).toBeInTheDocument()
    expect(within(item).getByText(/Vence el 2026-12-01/)).toBeInTheDocument()
    expect(within(item).getByRole('link')).toHaveAttribute('href', 'https://drive.example/informe')
  })

  it('sin adecuaciones lo dice en vez de dejar un hueco', async () => {
    render(<StudentAccommodationsPanel studentId="s1" />)
    expect(await screen.findByText('Sin adecuaciones cargadas.')).toBeInTheDocument()
  })

  it('agrega una adecuación con su enlace', async () => {
    render(<StudentAccommodationsPanel studentId="s1" />)
    await screen.findByText('Sin adecuaciones cargadas.')

    fireEvent.change(screen.getByLabelText(/Qué tener en cuenta al calificar/), {
      target: { value: 'Se sienta adelante.' },
    })
    fireEvent.change(screen.getByLabelText(/Enlace al informe/), {
      target: { value: 'https://drive.example/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/students/s1/accommodations')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      summary: 'Se sienta adelante.',
      externalUrl: 'https://drive.example/x',
    })
  })

  it('no manda nada sin el resumen: es el dato que el docente necesita', async () => {
    render(<StudentAccommodationsPanel studentId="s1" />)
    await screen.findByText('Sin adecuaciones cargadas.')

    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/qué tener en cuenta/i)
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('el enlace vacío viaja como null, no como cadena', async () => {
    render(<StudentAccommodationsPanel studentId="s1" />)
    await screen.findByText('Sin adecuaciones cargadas.')

    fireEvent.change(screen.getByLabelText(/Qué tener en cuenta al calificar/), {
      target: { value: 'Sin informe.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(mockedApi.mock.calls[1][1]?.body)).externalUrl).toBeNull()
  })

  it('quita una adecuación', async () => {
    mockedApi.mockResolvedValue({ data: [ROW] })

    render(<StudentAccommodationsPanel studentId="s1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Quitar la adecuación/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(mockedApi.mock.calls[1][0]).toBe('/admin/students/s1/accommodations/ad-1')
    expect(mockedApi.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('muestra el error del backend', async () => {
    mockedApi.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(new Error('El enlace tiene que ser una URL'))

    render(<StudentAccommodationsPanel studentId="s1" />)
    await screen.findByText('Sin adecuaciones cargadas.')

    fireEvent.change(screen.getByLabelText(/Qué tener en cuenta al calificar/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El enlace tiene que ser una URL')
  })
})
