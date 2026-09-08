import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DesarrolloSection from './DesarrolloSection'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

vi.mock('@/contexts/LibretaContext', () => ({ useLibreta: () => ({ gradeBookId: 'gb-1' }) }))

const ENTRY = {
  id: 'ent-1',
  date: '2026-05-12',
  hoursTaught: 2,
  hoursNotTaught: 0,
  description: 'Ley de Coulomb.',
  attachments: null,
}

const LOADED = {
  data: [ENTRY],
  totals: { hoursTaught: 46, hoursNotTaught: 4 },
  canEdit: true,
}

describe('<DesarrolloSection />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lista las clases con la fecha en formato local', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<DesarrolloSection />)

    expect(await screen.findByText('12/05/26')).toBeInTheDocument()
    expect(screen.getByText('Ley de Coulomb.')).toBeInTheDocument()
  })

  it('muestra los totales de horas del curso, no los del filtro', async () => {
    // El backend manda totals aparte justamente para que filtrar no cambie las horas del curso.
    mockedApi.mockResolvedValue(LOADED)

    render(<DesarrolloSection />)

    expect(await screen.findByText(/Hs\. dictadas: 46 · Hs\. no dictadas: 4/)).toBeInTheDocument()
  })

  it('registra una clase nueva y recarga', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<DesarrolloSection />)
    const description = await screen.findByLabelText('¿Qué se trabajó en clase?')

    fireEvent.change(description, { target: { value: 'Circuitos en serie.' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/gradebook/gb-1/development')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      hoursTaught: 2,
      hoursNotTaught: 0,
      description: 'Circuitos en serie.',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Clase registrada.')
  })

  it('no deja registrar una clase sin descripción', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<DesarrolloSection />)
    await screen.findByLabelText('¿Qué se trabajó en clase?')

    expect(screen.getByRole('button', { name: /Registrar/ })).toBeDisabled()
  })

  it('BUSCAR manda los filtros al backend', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<DesarrolloSection />)
    await screen.findByText('Ley de Coulomb.')

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-05-01' } })
    fireEvent.change(screen.getByLabelText('Buscar en el desarrollo'), { target: { value: 'coulomb' } })
    fireEvent.click(screen.getByRole('button', { name: 'BUSCAR' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    expect(String(mockedApi.mock.calls[1][0])).toBe('/gradebook/gb-1/development?from=2026-05-01&q=coulomb')
  })

  it('LIMPIAR vuelve a pedir sin filtros', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<DesarrolloSection />)
    await screen.findByText('Ley de Coulomb.')

    fireEvent.change(screen.getByLabelText('Buscar en el desarrollo'), { target: { value: 'coulomb' } })
    fireEvent.click(screen.getByRole('button', { name: 'BUSCAR' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'LIMPIAR' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(String(mockedApi.mock.calls[2][0])).toBe('/gradebook/gb-1/development?')
  })

  it('borra una clase identificándola por su fecha', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<DesarrolloSection />)
    await screen.findByText('Ley de Coulomb.')

    fireEvent.click(screen.getByRole('button', { name: 'Borrar la clase del 12/05/26' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(mockedApi.mock.calls[1][0]).toBe('/gradebook/gb-1/development/ent-1')
    expect(mockedApi.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('sin permiso de edición no ofrece alta ni borrado', async () => {
    mockedApi.mockResolvedValue({ ...LOADED, canEdit: false })

    render(<DesarrolloSection />)
    await screen.findByText('Ley de Coulomb.')

    expect(screen.queryByRole('button', { name: /Registrar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Borrar la clase/ })).not.toBeInTheDocument()
  })

  it('dice que no hay clases en vez de mostrar una tabla vacía', async () => {
    mockedApi.mockResolvedValue({ ...LOADED, data: [] })

    render(<DesarrolloSection />)

    expect(await screen.findByText('Todavía no hay clases registradas.')).toBeInTheDocument()
  })

  it('avisa si la carga falla', async () => {
    mockedApi.mockRejectedValue(new Error('Sin acceso'))

    render(<DesarrolloSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin acceso')
  })
})
