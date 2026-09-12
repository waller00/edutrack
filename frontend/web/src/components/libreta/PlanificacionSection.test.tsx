import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlanificacionSection from './PlanificacionSection'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

vi.mock('@/contexts/LibretaContext', () => ({ useLibreta: () => ({ gradeBookId: 'gb-1' }) }))

const LOADED = {
  data: { formative: 'Unidad 1: cinemática', replanning: null, attachments: null },
  canEdit: true,
}

describe('<PlanificacionSection />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carga la planificación existente en los campos', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<PlanificacionSection />)

    expect(await screen.findByLabelText('A — Planificación formativa')).toHaveValue('Unidad 1: cinemática')
    // Los nulos del backend entran como cadena vacía, nunca como "null" escrito en el textarea.
    expect(screen.getByLabelText('B — Replanificación')).toHaveValue('')
    expect(screen.getByLabelText('Material adjunto')).toHaveValue('')
  })

  it('guarda lo editado con PUT', async () => {
    mockedApi.mockResolvedValueOnce(LOADED).mockResolvedValueOnce({})

    render(<PlanificacionSection />)
    const replanning = await screen.findByLabelText('B — Replanificación')

    fireEvent.change(replanning, { target: { value: 'Se corrió la unidad 3 por paro docente.' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar planificación/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/gradebook/gb-1/planning')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({
      formative: 'Unidad 1: cinemática',
      replanning: 'Se corrió la unidad 3 por paro docente.',
      attachments: '',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Planificación guardada.')
  })

  it('sin permiso de edición deshabilita los campos y esconde el botón', async () => {
    mockedApi.mockResolvedValue({ ...LOADED, canEdit: false })

    render(<PlanificacionSection />)

    expect(await screen.findByLabelText('A — Planificación formativa')).toBeDisabled()
    expect(screen.getByLabelText('Material adjunto')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Guardar planificación/ })).not.toBeInTheDocument()
  })

  it('avisa si la carga falla', async () => {
    mockedApi.mockRejectedValue(new Error('Sin acceso a la libreta'))

    render(<PlanificacionSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin acceso a la libreta')
  })

  it('avisa si el guardado falla y no deja el botón trabado', async () => {
    mockedApi.mockResolvedValueOnce(LOADED).mockRejectedValueOnce(new Error('Ciclo cerrado'))

    render(<PlanificacionSection />)
    await screen.findByLabelText('A — Planificación formativa')

    fireEvent.click(screen.getByRole('button', { name: /Guardar planificación/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ciclo cerrado')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Guardar planificación/ })).not.toBeDisabled(),
    )
  })

  it('explica que EduTrack no guarda archivos', async () => {
    mockedApi.mockResolvedValue(LOADED)

    render(<PlanificacionSection />)

    expect(await screen.findByText(/EduTrack no almacena archivos/)).toBeInTheDocument()
  })
})
