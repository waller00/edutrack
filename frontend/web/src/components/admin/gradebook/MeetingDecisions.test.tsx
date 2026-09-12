import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MeetingDecisions from './MeetingDecisions'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const STUDENTS = [
  { studentId: 's1', firstName: 'Ana', lastName: 'Díaz' },
  { studentId: 's2', firstName: 'Beto', lastName: 'Sosa' },
]

function setup(rows: unknown[] = []) {
  mockedApi.mockResolvedValue({ data: rows })
  return render(
    <MeetingDecisions courseOfferingId="off-1" periodId="p-1" students={STUDENTS} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<MeetingDecisions />', () => {
  it('sin decisiones lo dice en vez de dejar un hueco', async () => {
    setup()
    expect(await screen.findByText(/no se registró ninguna decisión/)).toBeInTheDocument()
  })

  it('lista las decisiones con su autor y sobre quién son', async () => {
    setup([
      {
        id: 'd-1',
        decision: 'Se cita a la familia.',
        createdAt: '2026-06-10T12:00:00.000Z',
        student: { id: 's1', firstName: 'Ana', lastName: 'Díaz' },
        createdBy: { id: 'u-1', name: 'Adscripción' },
      },
      {
        id: 'd-2',
        decision: 'El grupo continúa con apoyo en Matemática.',
        createdAt: '2026-06-10T12:00:00.000Z',
        student: null,
        createdBy: null,
      },
    ])

    // Acotado a la lista: los nombres también son opciones del selector de alta.
    const item = (await screen.findByText('Se cita a la familia.')).closest('li')!
    expect(within(item).getByText('Díaz, Ana')).toBeInTheDocument()
    // Sin estudiante, la decisión es del grupo entero. "Todo el grupo" también es la opción por
    // defecto del selector, así que se busca dentro de la fila.
    const grupo = screen.getByText('El grupo continúa con apoyo en Matemática.').closest('li')!
    expect(within(grupo).getByText('Todo el grupo')).toBeInTheDocument()
    expect(within(grupo).getByText(/Sin autor/)).toBeInTheDocument()
  })

  it('registra una decisión sobre un estudiante', async () => {
    setup()
    await screen.findByText(/no se registró ninguna decisión/)

    fireEvent.change(screen.getByLabelText('Sobre'), { target: { value: 's2' } })
    fireEvent.change(screen.getByLabelText('Decisión'), { target: { value: 'Se deriva a APE.' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/gradebook/meeting-records')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      courseOfferingId: 'off-1',
      periodId: 'p-1',
      studentId: 's2',
      decision: 'Se deriva a APE.',
    })
  })

  it('sin estudiante la decisión es del grupo: no manda studentId', async () => {
    setup()
    await screen.findByText(/no se registró ninguna decisión/)

    fireEvent.change(screen.getByLabelText('Decisión'), { target: { value: 'Se refuerza convivencia.' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(mockedApi.mock.calls[1][1]?.body)).studentId).toBeUndefined()
  })

  it('no manda una decisión vacía', async () => {
    setup()
    await screen.findByText(/no se registró ninguna decisión/)

    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Escribí la decisión.')
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('muestra el error del backend', async () => {
    mockedApi.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(new Error('Período cerrado'))
    render(<MeetingDecisions courseOfferingId="off-1" periodId="p-1" students={STUDENTS} />)
    await screen.findByText(/no se registró ninguna decisión/)

    fireEvent.change(screen.getByLabelText('Decisión'), { target: { value: 'Algo' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Período cerrado')
  })
})
