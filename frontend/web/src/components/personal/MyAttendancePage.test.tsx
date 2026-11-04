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

vi.mock('next/navigation', () => ({ usePathname: () => '/me/attendance' }))

function renderPage(ui: React.ReactNode) {
  return render(<AuthProvider>{ui}</AuthProvider>)
}

vi.mock('@/components/personal/MyAttendanceMarkingPanel', () => ({
  default: () => null,
}))

const mockedApi = vi.mocked(api)

const ME = {
  id: 'user-1',
  role: 'TEACHER',
  isActive: true,
  isApproved: true,
  permissions: [{ id: 'attendance.read', scope: 'own' }],
}

/** Responde por dirección: la pantalla pide el ciclo, los registros y el resumen en paralelo. */
function respond({ records = [] as unknown[], summary = { person: null } as unknown, me = ME as unknown, schoolYear = null as unknown } = {}) {
  mockedApi.mockImplementation(async (path: string) => {
    if (path === '/auth/me') return me as never
    if (path === '/attendance/my-school-year') return { data: schoolYear } as never
    if (path.startsWith('/attendance/my-attendances')) return records as never
    if (path.startsWith('/attendance/summary')) return summary as never
    return { data: [] } as never
  })
}

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
    respond({
      records: [
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
      ],
    })

    renderPage(<MyAttendancePage role="TEACHER" />)

    await waitFor(() =>
      expect(screen.getByText('1 entrada · 1 salida · 0 faltas y ausencias')).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('heading', { name: 'Mis asistencias' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Entrada')).toBeInTheDocument()
    expect(screen.getByText('Presente')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar asistencia' })).not.toBeInTheDocument()
    expect(screen.getByText('En horario')).not.toBeVisible()
    fireEvent.click(screen.getAllByText('Notas del registro')[0])
    expect(screen.getByText('En horario')).toBeVisible()
    expect(screen.getByText('Salida')).toBeInTheDocument()
    expect(screen.getByText('Salida ok')).toBeInTheDocument()
    expect(screen.queryByText('Ausente')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no attendance records', async () => {
    respond()

    renderPage(<MyAttendancePage role="STAFF" />)

    expect(
      await screen.findByText('No hay registros de asistencia'),
    ).toBeInTheDocument()
  })

  it('reloads with updated query params when filters change', async () => {
    respond()

    renderPage(<MyAttendancePage role="TEACHER" />)
    await screen.findByText('No hay registros de asistencia')
    fireEvent.click(screen.getByRole('button', { name: /^Período/ }))
    fireEvent.change(screen.getByLabelText('Fecha inicio'), {
      target: { value: '01/03/2026' },
    })
    const endDateInput = await screen.findByLabelText('Fecha fin')
    fireEvent.change(endDateInput, { target: { value: '20/03/2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))

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

    await waitFor(() =>
      expect(window.location.href).toBe('/login?returnTo=%2Fme%2Fattendance'),
    )
  })
})

it('no consulta asistencia para una cuenta pendiente aunque tenga el permiso', async () => {
  mockLocation()
  mockedApi.mockReset()
  mockedApi.mockResolvedValue({ id: 'u1', role: 'TEACHER', isActive: true, isApproved: false, permissions: [{ id: 'attendance.read', scope: 'own' }] } as never)
  renderPage(<MyAttendancePage />)
  await waitFor(() => expect(window.location.href).toBe('/'))
  expect(mockedApi).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: 'Actualizar' })).not.toBeInTheDocument()
})
it('ofrece la marcación solo cuando el perfil tiene ambos permisos', async () => {
  mockLocation()
  mockedApi.mockReset()
  mockedApi.mockResolvedValueOnce({ id: 'u1', role: 'PERSONAL', isActive: true, isApproved: true, permissions: ['attendance.read', 'attendance.create', 'events.read'].map(id => ({ id, scope: 'own' })) } as never)
    .mockResolvedValue([] as never)
  renderPage(<MyAttendancePage />)
  expect(await screen.findByRole('button', { name: 'Marcar asistencia' })).toBeVisible()
})

it('distingue las faltas derivadas de las marcaciones de entrada y salida', async () => {
  mockLocation()
  mockedApi.mockReset()
  respond({
    records: [
      { id: 'in', type: 'CHECK_IN', status: 'PRESENT', date: '2026-10-09', time: '2026-10-09T12:00:00Z', event: { title: 'Clase con entrada' } },
      { id: 'out', type: 'CHECK_OUT', status: 'EXIT', date: '2026-10-09', time: '2026-10-09T13:00:00Z', event: { title: 'Clase con salida' } },
      { id: 'absence:e1', type: 'CHECK_IN', status: 'ABSENT_NOT_JUSTIFIED', date: '2026-10-09', time: '2026-10-09T14:00:00Z', event: { title: 'Clase sin asistencia' } },
    ],
  })
  renderPage(<MyAttendancePage />)
  await screen.findByText('1 entrada · 1 salida · 1 falta o ausencia')
  expect(screen.getByText('Falta')).toBeVisible()
  fireEvent.change(screen.getByLabelText('Tipo de registro'), { target: { value: 'absences' } })
  expect(screen.getByText('Clase sin asistencia')).toBeVisible()
  expect(screen.queryByText('Clase con entrada')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Tipo de registro'), { target: { value: 'CHECK_IN' } })
  expect(screen.getByText('Clase con entrada')).toBeVisible()
  expect(screen.queryByText('Clase sin asistencia')).not.toBeInTheDocument()
})

it('arranca en el ciclo lectivo, no el 1 de enero', async () => {
  mockLocation()
  mockedApi.mockReset()
  respond({ schoolYear: { from: '2026-03-02', to: '2026-03-20' } })
  renderPage(<MyAttendancePage />)
  await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('startDate=2026-03-02')))
})

it('el resumen dice de cuántos sale cada número, sin contar lo que cubrió', async () => {
  mockLocation()
  mockedApi.mockReset()
  const stats = {
    esperadas: 40, presente: 30, tarde: 6, ausenteJustificado: 2, ausenteNoJustificado: 1, suplido: 1, cobertura: 3,
    pctPuntualidad: 0, pctAsistencia: 0, pctAusentismo: 0, horasTrabajadas: 52.5, horasPlanificadas: 60, deltaHoras: 0,
    minTardeAcumulados: 48, minTardePromedio: 8,
  }
  respond({ summary: { person: { userId: 'user-1', nombre: 'Ana', rol: 'Docente', email: '', rows: [], stats: { ...stats, esperadas: 43 }, ownStats: stats, coverage: { classes: 3, hours: 4.5 } } } })
  renderPage(<MyAttendancePage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Resumen' }))
  expect(await screen.findByText('36 de 40 clases y turnos con entrada marcada.')).toBeInTheDocument()
  expect(screen.getByText('Clases que cubriste')).toBeInTheDocument()
})

