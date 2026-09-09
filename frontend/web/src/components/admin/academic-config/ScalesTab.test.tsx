import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ScalesTab from './ScalesTab'
import { api } from '@/lib/api/client'
import type { GradingScale } from '@/lib/academic-config/types'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

function scale(over: Partial<GradingScale> = {}): GradingScale {
  return {
    id: 's-1', code: 'NUM_1_10', name: 'Numérica 1-10', kind: 'NUMERIC',
    minValueHundredths: 100, maxValueHundredths: 1000, decimals: 0,
    description: null, isActive: true, sortOrder: 0, gaps: [],
    usage: { assessments: 0 },
    levels: [
      {
        id: 'l-1', code: 'INSUF', label: 'Insuficiente', descriptor: 'No alcanza.',
        minValueHundredths: 100, maxValueHundredths: 500,
        colorToken: 'red', iconToken: 'x', isPassing: false, isAlert: true, sortOrder: 0,
      },
    ],
    ...over,
  }
}

const onError = vi.fn()

describe('<ScalesTab />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lista las escalas con sus tramos', async () => {
    mockedApi.mockResolvedValue({ data: [scale()] })

    render(<ScalesTab onError={onError} />)

    expect(await screen.findByText('Numérica 1-10')).toBeInTheDocument()
    expect(screen.getByText('Insuficiente')).toBeInTheDocument()
  })

  it('crea una escala con sus tramos en centésimos', async () => {
    mockedApi.mockResolvedValue({ data: [scale()] })

    render(<ScalesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Nueva escala/ }))

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: 'SEMAFORO' } })
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Semáforo' } })
    fireEvent.change(screen.getByLabelText('Mínimo'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Máximo'), { target: { value: '3' } })

    fireEvent.click(screen.getByRole('button', { name: /Agregar tramo/ }))
    fireEvent.change(screen.getByLabelText('Código', { selector: '#level-code-1' }), { target: { value: 'LOGRADO' } })
    fireEvent.change(screen.getByLabelText('Etiqueta'), { target: { value: 'Logrado' } })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '3' } })

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/academic-config/scales')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ code: 'SEMAFORO', minValueHundredths: 100, maxValueHundredths: 300 })
    expect(body.levels[0]).toMatchObject({ code: 'LOGRADO', minValueHundredths: 100, maxValueHundredths: 300 })
  })

  it('avisa que editar los tramos re-clasifica las notas ya cargadas', async () => {
    mockedApi.mockResolvedValue({ data: [scale({ usage: { assessments: 7 } })] })

    render(<ScalesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    expect(screen.getByText(/ya se usa en/)).toHaveTextContent('7 evaluaciones')
    expect(screen.getByText(/se vuelven a clasificar/)).toBeInTheDocument()
  })

  it('no avisa nada si la escala no se usó todavía', async () => {
    mockedApi.mockResolvedValue({ data: [scale()] })

    render(<ScalesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    expect(screen.queryByText(/se vuelven a clasificar/)).not.toBeInTheDocument()
  })

  it('no llama al backend si dos tramos se pisan', async () => {
    mockedApi.mockResolvedValue({ data: [scale()] })

    render(<ScalesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    fireEvent.click(screen.getByRole('button', { name: /Agregar tramo/ }))
    fireEvent.change(screen.getByLabelText('Código', { selector: '#level-code-2' }), { target: { value: 'ALTO' } })
    fireEvent.change(screen.getByLabelText('Etiqueta', { selector: '#level-label-2' }), { target: { value: 'Alto' } })
    fireEvent.change(screen.getByLabelText('Desde', { selector: '#level-min-2' }), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Hasta', { selector: '#level-max-2' }), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Hasta', { selector: '#level-max-1' }), { target: { value: '6' } })

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/se pisan/i)
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('quita un tramo del formulario', async () => {
    mockedApi.mockResolvedValue({ data: [scale()] })

    render(<ScalesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    expect(screen.getByLabelText('Etiqueta')).toHaveValue('Insuficiente')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el tramo 1' }))

    expect(screen.queryByLabelText('Etiqueta')).not.toBeInTheDocument()
    expect(screen.getByText(/Sin tramos/)).toBeInTheDocument()
  })

  it('desactiva con DELETE tras confirmar', async () => {
    mockedApi.mockResolvedValue({ data: [scale()] })

    render(<ScalesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(mockedApi.mock.calls[1][0]).toBe('/admin/academic-config/scales/s-1')
    expect(mockedApi.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('muestra el error del backend sin cerrar el formulario', async () => {
    mockedApi
      .mockResolvedValueOnce({ data: [scale()] })
      .mockRejectedValueOnce(new Error('Ya existe una escala con ese código'))

    render(<ScalesTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una escala con ese código')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
