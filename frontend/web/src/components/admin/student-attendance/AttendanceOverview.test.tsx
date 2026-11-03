import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AttendanceOverview from './AttendanceOverview'
import { api } from '@/lib/api/client'

const { state } = vi.hoisted(() => ({ state: { query: 'schoolYearId=sy1', read: true } }))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => ({ schoolYearScopedQuery: state.query, loading: false }),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({
    me: { permissions: state.read ? [{ id: 'student-attendance.read', scope: 'all' }] : [] },
  }),
}))
vi.mock('recharts', () => ({
  ResponsiveContainer: () => null,
  BarChart: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))
const mockedApi = vi.mocked(api)
const ana = { studentId: 's1', firstName: 'Ana', lastName: 'Pérez', courseName: '7 EBI' }
const luis = { studentId: 's2', firstName: 'Luis', lastName: 'Gómez', courseName: '8 EBI' }

beforeEach(() => {
  state.query = 'schoolYearId=sy1'
  state.read = true
  mockedApi.mockImplementation(
    async (path) =>
      ({
        data: path.includes('absence-streaks')
          ? [
              { ...ana, from: '2026-04-01', to: '2026-04-06', days: 4, open: true },
              { ...luis, from: '2026-03-01', to: '2026-03-04', days: 3, open: false },
            ]
          : [
              { ...ana, absenceHundredths: 2450, threshold: 1800 },
              { ...luis, absenceHundredths: 2500, threshold: 2500 },
            ],
      }) as never,
  )
})

describe('<AttendanceOverview />', () => {
  it('recorre las vistas con flechas y conserva el foco en la pestaña activa', async () => {
    const onViewChange = vi.fn()
    render(<AttendanceOverview onViewChange={onViewChange} />)
    const tab = await screen.findByRole('tab', { name: 'Prioridad de seguimiento' })
    tab.focus()
    fireEvent.keyDown(tab, { key: 'ArrowRight' })
    const next = screen.getByRole('tab', { name: 'Faltas seguidas' })
    expect(next).toHaveFocus()
    expect(next).toHaveAttribute('aria-selected', 'true')
    expect(onViewChange).toHaveBeenCalledWith('seguidas')
    fireEvent.keyDown(next, { key: 'End' })
    expect(screen.getByRole('tab', { name: '18 y 25 faltas' })).toHaveFocus()
  })

  it('deduplica el seguimiento, muestra faltas fraccionadas y filtra gráficas y lista juntas', async () => {
    render(<AttendanceOverview />)
    const panel = await screen.findByRole('tabpanel', { name: 'Prioridad de seguimiento' })
    expect(within(panel).getAllByRole('link')).toHaveLength(2)
    expect(within(panel).getByRole('link', { name: 'Pérez, Ana' })).toHaveAttribute(
      'href',
      '/admin/student-attendance?studentId=s1&schoolYearId=sy1',
    )
    expect(within(panel).getByText('24,5')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Curso' }), {
      target: { value: '8 EBI' },
    })
    expect(within(panel).queryByText('Pérez, Ana')).not.toBeInTheDocument()
    expect(within(panel).getByText('Gómez, Luis')).toBeInTheDocument()
    expect(screen.getByText(/8 EBI: 0 con racha activa/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no existe' } })
    expect(screen.getByText('No hay alertas actuales con estos filtros.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(within(panel).getAllByRole('link')).toHaveLength(2)
  })

  it('conserva las rachas cortadas en el historial sin sumarlas a las rachas activas', async () => {
    render(<AttendanceOverview initialView="seguidas" />)
    const panel = await screen.findByRole('tabpanel', { name: 'Faltas seguidas' })
    expect(within(panel).getByText('Racha cortada')).toBeInTheDocument()
    expect(screen.getByText(/8 EBI: 0 con racha activa/)).toBeInTheDocument()
  })

  it('oculta enlaces a fichas para perfiles con reportes sin permiso de lectura de asistencia', async () => {
    state.read = false
    render(<AttendanceOverview />)
    const panel = await screen.findByRole('tabpanel', { name: 'Prioridad de seguimiento' })
    expect(within(panel).getByText('Pérez, Ana')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('muestra el fallo de carga y permite reintentar sin convertirlo en cero alertas', async () => {
    const implementation = mockedApi.getMockImplementation()!
    mockedApi.mockRejectedValue(new Error('No se pudo consultar asistencia'))
    render(<AttendanceOverview />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar asistencia')
    expect(screen.queryByText('Necesitan seguimiento')).not.toBeInTheDocument()
    mockedApi.mockImplementation(implementation)
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('descarta una respuesta del ciclo anterior cuando se cambia de ciclo durante la carga', async () => {
    let resolveOld!: (value: { data: unknown[] }) => void
    const old = new Promise<{ data: unknown[] }>((resolve) => {
      resolveOld = resolve
    })
    mockedApi.mockImplementation((path) =>
      path.includes('sy1') ? (old as never) : (Promise.resolve({ data: [] }) as never),
    )
    const { rerender } = render(<AttendanceOverview />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    state.query = 'schoolYearId=sy2'
    rerender(<AttendanceOverview />)
    expect(
      await screen.findByText('No se detectaron alertas actuales en las listas registradas.'),
    ).toBeInTheDocument()
    resolveOld({ data: [{ ...ana, absenceHundredths: 2500, threshold: 2500 }] })
    await waitFor(() => expect(screen.queryByText('Pérez, Ana')).not.toBeInTheDocument())
  })
})
