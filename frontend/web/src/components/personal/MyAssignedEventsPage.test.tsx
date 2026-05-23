import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MyAssignedEventsPage from '@/components/personal/MyAssignedEventsPage'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const mockedApi = vi.mocked(api)

function mockLocation() {
  const location = { href: '' }
  Object.defineProperty(window, 'location', {
    value: location,
    writable: true,
  })
  return location
}

describe('MyAssignedEventsPage', () => {
  beforeEach(() => {
    mockLocation()
    mockedApi.mockReset()
  })

  it('loads upcoming events by default and includes the assigned user filter', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 'user-1' } as never)
      .mockResolvedValueOnce([
        {
          id: 'event-1',
          title: 'Clase de Matematica',
          type: 'CLASE',
          status: 'SCHEDULED',
          startDate: '2026-03-18T00:00:00.000Z',
          startTime: '2026-03-18T08:30:00.000Z',
          endTime: '2026-03-18T10:00:00.000Z',
          isRecurring: false,
          daysOfWeek: [],
          user: { id: 'admin-1', name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
        },
      ] as never)

    render(<MyAssignedEventsPage role="TEACHER" />)

    expect(await screen.findByText('Clase de Matematica')).toBeInTheDocument()
    expect(screen.getByText('Programado')).toBeInTheDocument()
    expect(screen.getByText('Clase')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenLastCalledWith(
      expect.stringContaining('assignedUserId=user-1'),
    )
    expect(mockedApi).toHaveBeenLastCalledWith(
      expect.stringContaining('startDate='),
    )
    expect(mockedApi).toHaveBeenLastCalledWith(
      expect.stringContaining('endDate='),
    )
  })

  it('reloads without week range when switching to all events', async () => {
    mockedApi.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ id: 'user-1' } as never)
      if (path.startsWith('/events/my-events')) return Promise.resolve([] as never)
      return Promise.reject(new Error(`unexpected api call: ${path}`))
    })

    render(<MyAssignedEventsPage role="STAFF" />)
    const allButton = await screen.findByRole('button', { name: 'Todos' })
    await screen.findByText('No hay eventos para mostrar')
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))

    fireEvent.click(allButton)

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenLastCalledWith('/events/my-events?assignedUserId=user-1'),
    )
  })

  it('expands and collapses event details on user interaction', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 'user-1' } as never)
      .mockResolvedValueOnce([
        {
          id: 'event-1',
          title: 'Jornada Especial',
          description: 'Detalle extendido',
          type: 'EVENTO',
          status: 'SCHEDULED',
          startDate: '2026-03-18T00:00:00.000Z',
          isRecurring: true,
          daysOfWeek: [1, 3],
          recurrenceEnd: '2026-04-01T00:00:00.000Z',
          location: 'Salon 2',
          user: { id: 'admin-1', name: 'Admin', email: 'admin@test.com', role: 'ADMIN' },
        },
      ] as never)

    render(<MyAssignedEventsPage role="TEACHER" />)

    await screen.findByText('Jornada Especial')
    const toggle = screen.getByTitle('Expandir detalles')

    fireEvent.click(toggle)
    expect(screen.getByText('Detalle extendido')).toBeInTheDocument()
    expect(screen.getByText('Salon 2')).toBeInTheDocument()
    expect(screen.getByText(/Todos los Lun, Mié/)).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Contraer detalles'))
    expect(screen.queryByText('Detalle extendido')).not.toBeInTheDocument()
  })

  it('redirects to login when auth lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.mockRejectedValueOnce(new Error('401'))

    render(<MyAssignedEventsPage role="TEACHER" />)

    await waitFor(() => expect(window.location.href).toBe('/login'))
  })
})
