import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminEvents from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/components/forms/DateRangeFields', () => ({
  default: () => <div data-testid="dr" />,
}))
vi.mock('@/components/common/PaginationControls', () => ({
  default: () => <nav data-testid="pagination" />,
}))

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const baseEvent = {
  id: 'e1',
  title: 'Clase matutina',
  description: 'Desc',
  type: 'CLASE' as const,
  status: 'SCHEDULED' as const,
  startDate: '2025-06-01T00:00:00.000Z',
  endDate: '2025-06-01T00:00:00.000Z',
  startTime: '2025-06-01T08:00:00.000Z',
  endTime: '2025-06-01T10:00:00.000Z',
  user: { id: 'adm', name: 'Admin', email: 'a@b.com', role: 'ADMIN' },
  assignedUser: { id: 't1', name: 'Teach', username: 'profe1', email: 't@b.com', role: 'TEACHER' },
  recurrenceType: 'NONE' as const,
  isRecurring: false,
  daysOfWeek: [] as number[],
  _count: { attendances: 1 },
}

describe('AdminEvents', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
  })

  it('carga y muestra cabecera o lista vacía', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('events/all')) {
        return { total: 0, page: 1, pageSize: 20, data: [] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      return {}
    })

    render(<AdminEvents />)

    expect(await screen.findByText('Gestión de Eventos')).toBeInTheDocument()
    expect(await screen.findByText('No hay eventos')).toBeInTheDocument()
  })

  it('carga solo cursos activos para crear o filtrar eventos', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('events/all')) {
        return { total: 0, page: 1, pageSize: 20, data: [] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).startsWith('/courses')) return []
      return {}
    })

    render(<AdminEvents />)
    await screen.findByText('No hay eventos')

    const courseCalls = mockedApi.mock.calls.map((call) => String(call[0])).filter((url) => url.startsWith('/courses'))
    expect(courseCalls).toContain('/courses')
    expect(courseCalls.some((url) => url.includes('all=1'))).toBe(false)
  })

  it('cancela evento vía API', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('events/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [baseEvent] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('/events/e1/cancel') && init?.method === 'PUT') return {}
      return {}
    })

    render(<AdminEvents />)
    await screen.findByText('Clase matutina')

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/events/e1/cancel',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ reason: undefined }) }),
      ),
    )
  })

  it('muestra hora fin aunque el backend guarde endDate vacío para eventos del mismo día', async () => {
    const sameDayEvent = { ...baseEvent, endDate: undefined, endTime: '2025-06-01T19:00:00.000Z' }
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('events/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [sameDayEvent] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      return {}
    })

    render(<AdminEvents />)

    expect(await screen.findByText('Clase matutina')).toBeInTheDocument()
    expect(screen.getByText(/Fin/)).toHaveTextContent(/\d/)
    expect(screen.queryByText('Sin fecha fin')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const modal = await screen.findByRole('heading', { name: 'Editar Evento' }).then((h) => h.closest('div')!.parentElement!)
    expect(within(modal).getAllByDisplayValue('2025-06-01')).toHaveLength(2)
    expect(within(modal).getByText('Mismo día que la fecha del evento.')).toBeInTheDocument()
  })

  it('elimina eventos seleccionados tras confirmar', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('events/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [baseEvent] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).endsWith('/events/e1') && init?.method === 'DELETE') return {}
      return {}
    })

    render(<AdminEvents />)
    await screen.findByText('Clase matutina')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar evento Clase matutina' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar seleccionados' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/events/e1', expect.objectContaining({ method: 'DELETE' })),
    )
  })

  it('selecciona todos los eventos desde la cabecera', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('events/all')) {
        return { total: 2, page: 1, pageSize: 20, data: [baseEvent, { ...baseEvent, id: 'e2', title: 'Clase tarde' }] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      return {}
    })

    render(<AdminEvents />)
    await screen.findByText('Clase matutina')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los eventos' }))

    expect(screen.getByRole('checkbox', { name: 'Seleccionar evento Clase matutina' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar evento Clase tarde' })).toBeChecked()
  })

  it('reactiva evento cancelado', async () => {
    const cancelled = { ...baseEvent, status: 'CANCELLED' as const }
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('events/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [cancelled] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).endsWith('/events/e1') && init?.method === 'PUT') return {}
      return {}
    })

    render(<AdminEvents />)
    await screen.findByText('Clase matutina')

    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/events/e1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ status: 'SCHEDULED' }),
        }),
      ),
    )
  })

  it('edita y guarda cambios', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('events/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [baseEvent] }
      }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 't1', name: 'Teach', username: 'profe1', email: 't@b.com', role: 'TEACHER' }] }
      }
      if (String(url).endsWith('/events/e1') && init?.method === 'PUT') return {}
      return {}
    })

    render(<AdminEvents />)
    await screen.findByText('Clase matutina')

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const modal = await screen.findByRole('heading', { name: 'Editar Evento' }).then((h) => h.closest('div')!.parentElement!)
    const titleInput = within(modal).getByDisplayValue('Clase matutina')
    fireEvent.change(titleInput, { target: { value: 'Clase vespertina' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => {
      const put = mockedApi.mock.calls.find(
        (c) => String(c[0]).endsWith('/events/e1') && (c[1] as RequestInit)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      const body = JSON.parse((put![1] as RequestInit).body as string)
      expect(body.title).toBe('Clase vespertina')
    })
  })

  it('crea evento desde el modal', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('events/all')) {
        return { total: 0, page: 1, pageSize: 20, data: [] }
      }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 't1', name: 'Teach', username: 'profe1', email: 't@b.com', role: 'TEACHER' }] }
      }
      if (String(url) === '/events/' && init?.method === 'POST') return {}
      return {}
    })

    render(<AdminEvents />)
    await screen.findByText('No hay eventos')

    fireEvent.click(screen.getAllByRole('button', { name: 'Crear Evento' })[0])

    const createModal = screen.getByTestId('create-event-modal')
    const selects = () => createModal.querySelectorAll('select')
    fireEvent.change(selects()[0], { target: { value: 'TEACHER' } })
    await waitFor(() => expect(selects()[2]).not.toBeDisabled())
    fireEvent.change(selects()[2], { target: { value: 't1' } })
    fireEvent.change(within(createModal).getByPlaceholderText('Ej: Turno matutino'), {
      target: { value: 'Nuevo curso' },
    })
    fireEvent.change(within(createModal).getByTestId('create-event-start-h'), { target: { value: '10' } })
    fireEvent.change(within(createModal).getByTestId('create-event-start-m'), { target: { value: '00' } })
    fireEvent.change(within(createModal).getByTestId('create-event-end-h'), { target: { value: '11' } })
    fireEvent.change(within(createModal).getByTestId('create-event-end-m'), { target: { value: '00' } })

    const crearBtns = screen.getAllByRole('button', { name: 'Crear Evento' })
    fireEvent.click(crearBtns[crearBtns.length - 1])

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/events/',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Nuevo curso'),
        }),
      ),
    )
  })
})
