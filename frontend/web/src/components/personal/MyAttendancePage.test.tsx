import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MyAttendancePage from '@/components/personal/MyAttendancePage'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/personal/MyAttendanceMarkingPanel', () => ({
  default: () => null,
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

describe('MyAttendancePage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockLocation()
  })

  it('loads and renders attendance rows after the user is resolved', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 'user-1' } as never)
      .mockResolvedValueOnce([
        {
          id: 'att-1',
          type: 'CHECK_IN',
          status: 'PRESENT',
          date: '2026-03-10T00:00:00.000Z',
          time: '2026-03-10T08:30:00.000Z',
          notes: 'En horario',
        },
      ] as never)

    render(<MyAttendancePage role="TEACHER" />)

    expect(screen.getByText('Cargando...')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Total: 1 registros')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Mis Asistencias' })).toBeInTheDocument()
    expect(screen.getByText('Entrada')).toBeInTheDocument()
    expect(screen.getByText('Presente')).toBeInTheDocument()
    expect(screen.getByText('En horario')).toBeInTheDocument()
  })

  it('shows the empty state when there are no attendance records', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 'user-1' } as never)
      .mockResolvedValueOnce([] as never)

    render(<MyAttendancePage role="STAFF" />)

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No hay registros de asistencia')).toBeInTheDocument()
  })

  it('reloads with updated query params when filters change', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 'user-1' } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)

    render(<MyAttendancePage role="TEACHER" />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    const endDateInput = await screen.findByLabelText('Fecha fin')
    fireEvent.change(endDateInput, { target: { value: '2026-03-20' } })

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        expect.stringContaining('endDate=2026-03-20'),
      ),
    )
  })

  it('redirects to login when the initial auth lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.mockRejectedValueOnce(new Error('401'))

    render(<MyAttendancePage role="TEACHER" />)

    await waitFor(() => expect(window.location.href).toBe('/login'))
  })
})
