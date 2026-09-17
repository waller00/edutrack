import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GroupSwitcher from './GroupSwitcher'
import { api } from '@/lib/api/client'
import type { GradeBookHeader } from '@/lib/gradebook/types'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const push = vi.fn()
// El router tiene que ser el MISMO objeto en cada render (ver ElegirLibreta.test.tsx).
const router = { push, replace: vi.fn() }
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return { ...actual, useRouter: () => router }
})

function book(id: string, subject: string): GradeBookHeader {
  return {
    id,
    status: 'ACTIVE',
    schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
    course: { id: 'c-1', name: 'Primero', code: '1-EMS', level: 'EMS' },
    courseOfferingId: 'off-1',
    orientation: null,
    subject: { id: `s-${id}`, name: subject, code: null },
    teacher: { id: 'u-1', name: 'Ana Benítez', username: 'abenitez' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<GroupSwitcher />', () => {
  it('con una sola libreta no muestra selector: no hay nada que elegir', async () => {
    mockedApi.mockResolvedValue({ data: [book('gb-1', 'Física')] })

    render(<GroupSwitcher gradeBookId="gb-1" section="evaluaciones" />)

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    expect(screen.queryByLabelText('Cambiar de grupo')).not.toBeInTheDocument()
  })

  it('lista los grupos del docente y marca el abierto', async () => {
    mockedApi.mockResolvedValue({ data: [book('gb-1', 'Física'), book('gb-2', 'Química')] })

    render(<GroupSwitcher gradeBookId="gb-2" section="evaluaciones" />)

    const select = await screen.findByLabelText('Cambiar de grupo')
    expect(select).toHaveValue('gb-2')
    expect(screen.getByRole('option', { name: '1-EMS · FÍSICA' })).toBeInTheDocument()
  })

  it('cambiar de grupo conserva la sección abierta', async () => {
    // Es lo que hace que se sienta una libreta y no seis.
    mockedApi.mockResolvedValue({ data: [book('gb-1', 'Física'), book('gb-2', 'Química')] })

    render(<GroupSwitcher gradeBookId="gb-1" section="evaluaciones" />)
    fireEvent.change(await screen.findByLabelText('Cambiar de grupo'), { target: { value: 'gb-2' } })

    expect(push).toHaveBeenCalledWith('/libreta/gb-2/evaluaciones')
  })

  it('desde la portada cambia a la portada del otro grupo', async () => {
    mockedApi.mockResolvedValue({ data: [book('gb-1', 'Física'), book('gb-2', 'Química')] })

    render(<GroupSwitcher gradeBookId="gb-1" section={null} />)
    fireEvent.change(await screen.findByLabelText('Cambiar de grupo'), { target: { value: 'gb-2' } })

    expect(push).toHaveBeenCalledWith('/libreta/gb-2')
  })

  it('si la lista falla, la libreta abierta sigue andando', async () => {
    mockedApi.mockRejectedValue(new Error('sin red'))

    render(<GroupSwitcher gradeBookId="gb-1" section="cierre" />)

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    expect(screen.queryByLabelText('Cambiar de grupo')).not.toBeInTheDocument()
  })
})
