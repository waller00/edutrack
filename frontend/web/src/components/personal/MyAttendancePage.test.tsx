import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MyAttendancePage from '@/components/personal/MyAttendancePage'
import { AuthProvider } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/lib/observability/user-session', () => ({
  identifyObservabilityUser: vi.fn(),
  clearObservabilityUser: vi.fn(),
}))

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

function renderPage(ui: React.ReactNode) {
  return render(<AuthProvider>{ui}</AuthProvider>)
}

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
        {
          id: 'att-2',
          type: 'CHECK_OUT',
          status: 'EXIT',
          date: '2026-03-10T00:00:00.000Z',
          time: '2026-03-10T10:30:00.000Z',
          notes: 'Salida ok',
        },
      ] as never)

    renderPage(<MyAttendancePage role="TEACHER" />)

    expect(screen.getByText('Cargando...')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Total: 2 registros')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Mis Asistencias' })).toBeInTheDocument()
    expect(screen.getByText('Entrada')).toBeInTheDocument()
    expect(screen.getByText('Presente')).toBeInTheDocument()
    expect(screen.getByText('En horario')).toBeInTheDocument()
    expect(screen.getAllByText('Salida').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Salida ok')).toBeInTheDocument()
    expect(screen.queryByText('Ausente')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no attendance records', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 'user-1' } as never)
      .mockResolvedValueOnce([] as never)

    renderPage(<MyAttendancePage role="STAFF" />)

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No hay registros de asistencia')).toBeInTheDocument()
  })

  it('reloads with updated query params when filters change', async () => {
    mockedApi
      .mockResolvedValueOnce({ id: 'user-1' } as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)

    renderPage(<MyAttendancePage role="TEACHER" />)
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

    renderPage(<MyAttendancePage role="TEACHER" />)

    await waitFor(() => expect(window.location.href).toBe('/login'))
  })
})
