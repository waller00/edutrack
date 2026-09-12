import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CompletenessPanel from './CompletenessPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const PERIODS = { data: [{ periodId: 'p-1', name: 'Mayo' }] }

function row(over: Record<string, unknown> = {}) {
  return {
    gradeBookId: 'gb-1',
    subjectName: 'Matemática',
    courseName: '1 EMS',
    teacherName: 'Ana Benítez',
    periodStatus: 'OPEN',
    rosterSize: 20,
    missingGrades: 6,
    missingJudgements: 0,
    complete: false,
    ...over,
  }
}

function respond(rows: unknown[]) {
  mockedApi.mockImplementation((path: string) => {
    if (String(path).includes('/completeness')) {
      return Promise.resolve({ period: { name: 'Mayo' }, data: rows })
    }
    return Promise.resolve(PERIODS)
  })
}

async function pickPeriod() {
  fireEvent.change(await screen.findByLabelText('Período'), { target: { value: 'p-1' } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<CompletenessPanel />', () => {
  it('arranca pidiendo el período en vez de mostrar una tabla vacía', async () => {
    respond([])
    render(<CompletenessPanel />)
    // El texto también es la opción vacía del selector: se busca el cartel, no el `<option>`.
    expect(
      await screen.findByText('Elegí un período para ver qué libretas están incompletas.'),
    ).toBeInTheDocument()
  })

  it('dice cuántos estudiantes faltan, no sólo que falta algo', async () => {
    respond([row()])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByText('Mayo: 6 sin calificación.')).toBeInTheDocument()
    expect(screen.getByText('Ana Benítez')).toBeInTheDocument()
  })

  it('nombra las dos cosas cuando faltan las dos', async () => {
    respond([row({ missingGrades: 6, missingJudgements: 9 })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(
      await screen.findByText('Mayo: 6 sin calificación y 9 sin juicio conceptual.'),
    ).toBeInTheDocument()
  })

  it('por defecto esconde las completas: son las que no hay que reclamar', async () => {
    respond([row(), row({ gradeBookId: 'gb-2', subjectName: 'Historia', complete: true })])
    render(<CompletenessPanel />)
    await pickPeriod()

    await screen.findByText(/1 EMS · Matemática/)
    expect(screen.queryByText(/Historia/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Sólo las que faltan'))
    expect(await screen.findByText(/Historia/)).toBeInTheDocument()
  })

  it('avisa al docente con el detalle de lo que falta', async () => {
    respond([row()])
    render(<CompletenessPanel />)
    await pickPeriod()

    fireEvent.click(await screen.findByRole('button', { name: /Avisar al docente/ }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'POST')
      expect(String(post?.[0])).toBe('/admin/gradebook/completeness/gb-1/request')
      expect(JSON.parse((post?.[1] as any).body).detail).toBe('Mayo: 6 sin calificación.')
    })
    expect(await screen.findByText('Avisado')).toBeInTheDocument()
  })

  it('no deja avisar si la libreta no tiene titular', async () => {
    respond([row({ teacherName: null })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByRole('button', { name: /Avisar al docente/ })).toBeDisabled()
  })

  it('celebra cuando no falta nada', async () => {
    respond([row({ complete: true })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByText('Todas las libretas están completas.')).toBeInTheDocument()
  })

  it('muestra el error sin dejar la pantalla en blanco', async () => {
    mockedApi.mockImplementation((path: string) =>
      String(path).includes('/completeness')
        ? Promise.reject(new Error('Sin permiso'))
        : Promise.resolve(PERIODS),
    )
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin permiso')
  })
})
