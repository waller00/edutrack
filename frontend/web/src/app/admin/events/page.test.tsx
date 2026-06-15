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

    expect(await screen.findByText('Agenda y clases')).toBeInTheDocument()
    expect(await screen.findByText('No hay actividades')).toBeInTheDocument()
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
    await screen.findByText('No hay actividades')

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
    await screen.findAllByText('Clase matutina')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Cancelar' }))

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

    expect((await screen.findAllByText('Clase matutina')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Fin/)).toHaveTextContent(/\d/)
    expect(screen.queryByText('Sin fecha fin')).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Editar' }))
    const modal = await screen.findByRole('heading', { name: 'Editar actividad' }).then((h) => h.closest('div')!.parentElement!)
    expect(within(modal).getAllByDisplayValue('2025-06-01')).toHaveLength(2)
    expect(within(modal).getByText('Mismo día que la fecha del evento.')).toBeInTheDocument()
  })

  it('muestra los próximos 7 días con sus actividades (resuelve recurrencias)', async () => {
    // Evento diario vigente: ocurre todos los días del rango → aparece en la vista.
    const dailyEvent = {
      ...baseEvent,
      isRecurring: true,
      recurrenceType: 'DAILY' as const,
      daysOfWeek: [] as number[],
      recurrenceEnd: '2099-12-31T00:00:00.000Z',
    }
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('events/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [dailyEvent] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      return {}
    })

    render(<AdminEvents />)

    expect(await screen.findByText('Próximos 7 días')).toBeInTheDocument()
    expect(screen.getAllByText('Clase matutina').length).toBeGreaterThan(0)
  })

  it('abre la lista del día al hacer click en una tarjeta', async () => {
    const dailyEvents = ['Clase 1', 'Clase 2', 'Clase 3', 'Clase 4'].map((title, index) => ({
      ...baseEvent,
      id: `daily-${index + 1}`,
      title,
      isRecurring: true,
      recurrenceType: 'DAILY' as const,
      daysOfWeek: [] as number[],
      recurrenceEnd: '2099-12-31T00:00:00.000Z',
      startTime: `2025-06-02T${String(8 + index).padStart(2, '0')}:00:00.000Z`,
      endTime: `2025-06-02T${String(9 + index).padStart(2, '0')}:00:00.000Z`,
      course: { id: 'c1', name: 'Tercero C', code: '3C' },
      subject: { id: 's1', name: 'Matemática', code: 'MAT' },
    }))
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('events/all')) {
        return { total: dailyEvents.length, page: 1, pageSize: 20, data: dailyEvents }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      return {}
    })

    render(<AdminEvents />)

    await screen.findByText('Próximos 7 días')
    fireEvent.click(screen.getByRole('button', { name: /Hoy/ }))

    const detail = await screen.findByRole('region', { name: /Actividades del Hoy/ })
    for (const event of dailyEvents) {
      expect(within(detail).getByText(event.title)).toBeInTheDocument()
    }
    expect(within(detail).getAllByText(/Tercero C · Matemática/)).toHaveLength(4)
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
    await screen.findAllByText('Clase matutina')

    fireEvent.click(within(screen.getByRole('table')).getByRole('checkbox', { name: 'Seleccionar actividad Clase matutina' }))

    // Esperar a que el botón se habilite (selección aplicada) evita un click
    // no-op por timing en CI que dejaría el DELETE sin disparar.
    const deleteButton = screen.getByRole('button', { name: 'Eliminar seleccionadas' })
    await waitFor(() => expect(deleteButton).toBeEnabled())
    fireEvent.click(deleteButton)

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
    await screen.findAllByText('Clase matutina')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las actividades' }))

    const table = screen.getByRole('table')
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar actividad Clase matutina' })).toBeChecked()
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar actividad Clase tarde' })).toBeChecked()
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
    await screen.findAllByText('Clase matutina')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Reactivar' }))

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
    await screen.findAllByText('Clase matutina')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Editar' }))
    const modal = await screen.findByRole('heading', { name: 'Editar actividad' }).then((h) => h.closest('div')!.parentElement!)
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
    await screen.findByText('No hay actividades')

    fireEvent.click(screen.getAllByRole('button', { name: 'Nueva actividad' })[0])

    const createModal = screen.getByTestId('create-event-modal')
    const selects = () => createModal.querySelectorAll('select')
    fireEvent.change(selects()[0], { target: { value: 'TEACHER' } })
    await waitFor(() => expect(selects()[2]).not.toBeDisabled())
    fireEvent.change(selects()[2], { target: { value: 't1' } })
    fireEvent.change(within(createModal).getByPlaceholderText('Ej: Turno matutino'), {
      target: { value: 'Nuevo curso' },
    })
    const startDateInput = createModal.querySelector('input[type="date"]')
    expect(startDateInput).not.toBeNull()
    fireEvent.change(startDateInput!, { target: { value: '2099-06-15' } })
    fireEvent.change(within(createModal).getByTestId('create-event-start-h'), { target: { value: '10' } })
    fireEvent.change(within(createModal).getByTestId('create-event-start-m'), { target: { value: '00' } })
    fireEvent.change(within(createModal).getByTestId('create-event-end-h'), { target: { value: '11' } })
    fireEvent.change(within(createModal).getByTestId('create-event-end-m'), { target: { value: '00' } })

    const crearBtns = screen.getAllByRole('button', { name: 'Nueva actividad' })
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
