import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ElegirLibreta from './ElegirLibreta'
import { api } from '@/lib/api/client'
import type { GradeBookHeader } from '@/lib/gradebook/types'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const push = vi.fn()
const replace = vi.fn()
// El router tiene que ser el MISMO objeto en cada render: `load` lo lleva en sus dependencias,
// así que devolver uno nuevo dispara el efecto sin parar y el componente nunca sale de "cargando".
const router = { push, replace }
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return { ...actual, useRouter: () => router }
})

function book(over: Partial<GradeBookHeader> = {}): GradeBookHeader {
  return {
    id: 'gb-1',
    status: 'ACTIVE',
    schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
    course: { id: 'c-1', name: 'Primero', code: '1-EMS', level: 'EMS' },
    courseOfferingId: 'off-1',
    orientation: null,
    subject: { id: 'sub-1', name: 'Física', code: 'FIS' },
    teacher: { id: 'u-1', name: 'Ana Benítez', username: 'abenitez' },
    ...over,
  }
}

const PROPS = {
  section: 'evaluaciones' as const,
  title: 'Evaluaciones',
  hint: 'Cargá las notas del período.',
}

describe('<ElegirLibreta />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('con una sola libreta entra derecho, sin pedir que elija', async () => {
    mockedApi.mockResolvedValue({ data: [book()] })

    render(<ElegirLibreta {...PROPS} />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/libreta/gb-1/evaluaciones'))
    expect(push).not.toHaveBeenCalled()
  })

  it('con varias libretas pide elegir y navega a la seleccionada', async () => {
    mockedApi.mockResolvedValue({
      data: [book(), book({ id: 'gb-2', subject: { id: 's2', name: 'Química', code: null } })],
    })

    render(<ElegirLibreta {...PROPS} />)

    expect(await screen.findByText('Elegí la libreta:')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /1-EMS · QUÍMICA/ }))

    expect(push).toHaveBeenCalledWith('/libreta/gb-2/evaluaciones')
  })

  it('muestra el título y la explicación de la entrada', async () => {
    mockedApi.mockResolvedValue({ data: [book(), book({ id: 'gb-2' })] })

    render(<ElegirLibreta {...PROPS} />)

    expect(await screen.findByRole('heading', { name: 'Evaluaciones' })).toBeInTheDocument()
    expect(screen.getByText('Cargá las notas del período.')).toBeInTheDocument()
  })

  it('nombra al docente o aclara que no hay titular', async () => {
    mockedApi.mockResolvedValue({ data: [book(), book({ id: 'gb-2', teacher: null })] })

    render(<ElegirLibreta {...PROPS} />)

    expect(await screen.findByText('Ana Benítez')).toBeInTheDocument()
    expect(screen.getByText('Sin titular')).toBeInTheDocument()
  })

  it('sin libretas no ofrece elegir nada', async () => {
    mockedApi.mockResolvedValue({ data: [] })

    render(<ElegirLibreta {...PROPS} />)

    expect(await screen.findByText('No tenés libretas en este ciclo.')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('avisa si la carga falla', async () => {
    mockedApi.mockRejectedValue(new Error('Sesión vencida'))

    render(<ElegirLibreta {...PROPS} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sesión vencida')
  })
})
