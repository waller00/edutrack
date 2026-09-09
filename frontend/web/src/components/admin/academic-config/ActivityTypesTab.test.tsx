import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityTypesTab from './ActivityTypesTab'
import { api } from '@/lib/api/client'
import type { ActivityType } from '@/lib/academic-config/types'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

function type(over: Partial<ActivityType> = {}): ActivityType {
  return {
    id: 't-1', code: 'ESCRITO', name: 'Escrito', description: 'Prueba escrita',
    scope: 'GLOBAL', isActive: true, sortOrder: 1, usage: { assessments: 0 },
    ...over,
  }
}

const onError = vi.fn()

describe('<ActivityTypesTab />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lista el catálogo institucional', async () => {
    mockedApi.mockResolvedValue({ data: [type()] })

    render(<ActivityTypesTab onError={onError} />)

    expect(await screen.findByText('Escrito')).toBeInTheDocument()
    expect(screen.getByText('ESCRITO')).toBeInTheDocument()
  })

  it('crea uno nuevo con POST', async () => {
    mockedApi.mockResolvedValue({ data: [type()] })

    render(<ActivityTypesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Nuevo tipo de actividad/ }))

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: 'DOMICILIARIO' } })
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Trabajo domiciliario' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/academic-config/activity-types')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      code: 'DOMICILIARIO', name: 'Trabajo domiciliario',
    })
  })

  it('edita con PATCH y sin mandar el código', async () => {
    mockedApi.mockResolvedValue({ data: [type()] })

    render(<ActivityTypesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Escrito largo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(mockedApi.mock.calls[1][0]).toBe('/admin/academic-config/activity-types/t-1')
    expect(mockedApi.mock.calls[1][1]?.method).toBe('PATCH')
    expect(JSON.parse(String(mockedApi.mock.calls[1][1]?.body))).not.toHaveProperty('code')
  })

  it('no llama al backend con un código mal formado', async () => {
    mockedApi.mockResolvedValue({ data: [type()] })

    render(<ActivityTypesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Nuevo tipo de actividad/ }))

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Sin código' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/código/i)
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('desactiva con DELETE tras confirmar', async () => {
    mockedApi.mockResolvedValue({ data: [type()] })

    render(<ActivityTypesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(mockedApi.mock.calls[1][0]).toBe('/admin/academic-config/activity-types/t-1')
    expect(mockedApi.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('muestra el uso de cada tipo', async () => {
    mockedApi.mockResolvedValue({ data: [type({ usage: { assessments: 12 } })] })

    render(<ActivityTypesTab onError={onError} />)

    expect(await screen.findByText('12 evaluaciones')).toBeInTheDocument()
  })
})
