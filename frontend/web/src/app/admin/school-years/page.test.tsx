import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SchoolYearsPage from './page'
import { useAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useAdminSchoolYear: vi.fn() }))

const mockedUseCtx = vi.mocked(useAdminSchoolYear)
const mockedApi = vi.mocked(api)

const years = [
  {
    id: 'y1',
    code: 2026,
    label: 'Ciclo 2026',
    startsOn: '2026-03-01T00:00:00.000Z',
    endsOn: null,
    status: 'ACTIVE',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    coursesCount: 4,
  },
  {
    id: 'y2',
    code: 2025,
    label: 'Ciclo 2025',
    startsOn: '2025-03-01T00:00:00.000Z',
    endsOn: null,
    status: 'CLOSED',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    coursesCount: 0,
  },
]

function ctx(over?: Partial<ReturnType<typeof useAdminSchoolYear>>) {
  return {
    loading: false,
    years,
    activeId: 'y1',
    selectedId: null,
    allYears: false,
    setSelectedId: vi.fn(),
    setAllYears: vi.fn(),
    reload: vi.fn(),
    schoolYearQuery: '',
    schoolYearScopedQuery: '',
    ...over,
  } as ReturnType<typeof useAdminSchoolYear>
}

describe('SchoolYearsPage', () => {
  beforeEach(() => {
    mockedUseCtx.mockReset()
    mockedApi.mockReset()
    mockedUseCtx.mockReturnValue(ctx())
  })

  it('muestra los ciclos en la tabla con su estado e indicador institucional', () => {
    render(<SchoolYearsPage />)

    const table = screen.getByRole('table')
    expect(within(table).getByText('Ciclo 2026')).toBeInTheDocument()
    expect(within(table).getByText(/· institucional/)).toBeInTheDocument()
    expect(within(table).getByText('Cerrado')).toBeInTheDocument()
  })

  it('renderiza las tarjetas mobile además de la tabla', () => {
    render(<SchoolYearsPage />)

    // El código del ciclo aparece en la fila de tabla y en la tarjeta mobile.
    expect(screen.getAllByText('2026').length).toBeGreaterThanOrEqual(2)
  })

  it('muestra el vacío cuando no hay ciclos', () => {
    mockedUseCtx.mockReturnValue(ctx({ years: [] }))
    render(<SchoolYearsPage />)

    // Mensaje de vacío en tabla y en la lista mobile.
    expect(screen.getAllByText('No hay ciclos cargados.').length).toBeGreaterThanOrEqual(1)
  })

  it('permite activar manualmente un ciclo cerrado cuando no hay ciclo activo', async () => {
    const reload = vi.fn()
    mockedApi.mockResolvedValue({} as never)
    mockedUseCtx.mockReturnValue(ctx({ activeId: null, years: [years[1]] as never, reload }))

    render(<SchoolYearsPage />)
    fireEvent.click(screen.getAllByRole('button', { name: /Activar/ })[0])

    await waitFor(() => {
      expect(mockedApi).toHaveBeenCalledWith('/admin/school-years/y2/activate', { method: 'POST' })
    })
    expect(reload).toHaveBeenCalled()
  })

  it('combina búsqueda y estado sin cargar datos de nuevo y conserva la comparación completa', () => {
    mockedUseCtx.mockReturnValue(ctx({ years: [...years, plannedYear] as never }))
    render(<SchoolYearsPage />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.getByText('Comparar dos ciclos').closest('details')).not.toHaveAttribute('open')
    fireEvent.change(screen.getByLabelText('Buscar ciclo'), { target: { value: '  2027  ' } })
    expect(within(table).getByText('Ciclo 2027')).toBeInTheDocument()
    expect(within(table).queryByText('Ciclo 2026')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrados' }))
    expect(within(table).getByText('No hay ciclos con estos filtros.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar ciclo'), { target: { value: '' } })
    expect(within(table).getByText('Ciclo 2025')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrados' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2026 · Ciclo 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Comparar dos ciclos'))
    expect(within(screen.getByLabelText('Ciclo A')).getAllByRole('option')).toHaveLength(4)
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('muestra solo acciones aplicables y conserva el cierre dentro del menú', async () => {
    const reload = vi.fn()
    mockedUseCtx.mockReturnValue(ctx({ reload }))
    mockedApi.mockResolvedValue({} as never)
    render(<SchoolYearsPage />)
    expect(screen.getByRole('button', { name: 'Nuevo ciclo lectivo' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Activar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Borrar ciclo' })).toBeNull()
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Más acciones de ciclo 2026' }))
    const menu = within(screen.getByRole('dialog', { name: 'Acciones de ciclo 2026' }))
    fireEvent.click(menu.getByRole('button', { name: 'Cerrar ciclo' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/school-years/y1/close', { method: 'POST' }))
    expect(reload).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mantiene el diálogo de confirmación para borrar y cancelar no cambia el ciclo', async () => {
    const reload = vi.fn()
    mockedUseCtx.mockReturnValue(ctx({ reload }))
    mockedApi.mockResolvedValue({} as never)
    render(<SchoolYearsPage />)
    const trigger = within(screen.getByRole('table')).getByRole('button', { name: 'Más acciones de ciclo 2025' })
    fireEvent.click(trigger)
    const menu = within(screen.getByRole('dialog', { name: 'Acciones de ciclo 2025' }))
    expect(menu.queryByRole('button', { name: 'Cerrar ciclo' })).toBeNull()
    fireEvent.click(menu.getByRole('button', { name: 'Borrar ciclo' }))
    expect(screen.getByRole('heading', { name: 'Borrar ciclo 2025' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockedApi).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar ciclo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/school-years/y2', { method: 'DELETE' }))
    expect(reload).toHaveBeenCalled()
  })

  it('abre el alta a pedido y crea un ciclo planificado', async () => {
    const reload = vi.fn()
    mockedUseCtx.mockReturnValue(ctx({ activeId: null, years: [years[1]] as never, reload }))
    mockedApi.mockResolvedValue({} as never)
    render(<SchoolYearsPage />)
    expect(screen.queryByLabelText('Código (año)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo ciclo lectivo' }))
    fireEvent.change(screen.getByLabelText('Código (año)'), { target: { value: '2027' } })
    fireEvent.change(screen.getByLabelText('Etiqueta'), { target: { value: ' Ciclo 2027 ' } })
    fireEvent.change(screen.getByLabelText('Inicio (opcional)'), { target: { value: '01/03/2027' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear ciclo' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/school-years', { method: 'POST', body: JSON.stringify({ code: 2027, label: 'Ciclo 2027', status: 'PLANNED', startsOn: '2027-03-01T00:00:00.000Z' }) }))
    expect(reload).toHaveBeenCalled()
    expect(screen.queryByLabelText('Código (año)')).toBeNull()
  })

  it('edita el ciclo desde la lista compacta', async () => {
    mockedApi.mockResolvedValue({} as never)
    render(<SchoolYearsPage />)
    fireEvent.click(within(screen.getByRole('table')).getAllByRole('button', { name: 'Editar' })[0])
    fireEvent.change(screen.getByLabelText('Etiqueta'), { target: { value: 'Ciclo actualizado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/school-years/y1', { method: 'PATCH', body: JSON.stringify({ label: 'Ciclo actualizado', startsOn: '2026-03-01T00:00:00.000Z' }) }))
  })

  it('compara dos ciclos desde el panel plegable aunque la lista esté filtrada', async () => {
    mockedApi.mockResolvedValue({ a: { ...years[0], studentsTotal: 20, studentsByStatus: { ACTIVE: 20 } }, b: { ...years[1], studentsTotal: 10, studentsByStatus: { GRADUATED: 10 } } } as never)
    render(<SchoolYearsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Activos' }))
    fireEvent.click(screen.getByText('Comparar dos ciclos'))
    fireEvent.change(screen.getByLabelText('Ciclo A'), { target: { value: 'y1' } })
    fireEvent.change(screen.getByLabelText('Ciclo B'), { target: { value: 'y2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/school-years/compare-metrics?a=y1&b=y2'))
    expect((await screen.findAllByText('20')).length).toBeGreaterThan(0)
    expect(screen.getByText('Egresó')).toBeInTheDocument()
  })

})

const plannedYear = {
  id: 'y3',
  code: 2027,
  label: 'Ciclo 2027',
  startsOn: null,
  endsOn: null,
  status: 'PLANNED',
  createdAt: '2027-01-01',
  updatedAt: '2027-01-01',
  coursesCount: 0,
}

const startPlan = {
  target: plannedYear,
  source: null,
  sourceYears: [],
  courses: [
    { id: 'c1', name: '1ro', code: 'A', level: null, sortOrder: 0, targetOffered: false, sourceOffered: true, recommended: true, orientations: [] },
    { id: 'c2', name: '2do', code: 'B', level: null, sortOrder: 1, targetOffered: false, sourceOffered: true, recommended: true, orientations: [] },
  ],
  students: [
    { studentId: 's1', firstName: 'Ana', lastName: 'García', documentId: '111', sourceCourseId: 'c1', sourceCourseName: '1ro', sourceCourseCode: 'A', sourceOrientationId: null, sourceOrientationName: null, sourceOrientationCode: null, enrollmentStatus: 'ACTIVE' },
    { studentId: 's2', firstName: 'Beto', lastName: 'Pérez', documentId: '222', sourceCourseId: 'c2', sourceCourseName: '2do', sourceCourseCode: 'B', sourceOrientationId: null, sourceOrientationName: null, sourceOrientationCode: null, enrollmentStatus: 'ACTIVE' },
  ],
}

async function openStudentsStep() {
  mockedApi.mockImplementation((url: string) =>
    String(url).includes('start-plan') ? Promise.resolve(startPlan as never) : Promise.resolve({} as never),
  )
  render(<SchoolYearsPage />)
  fireEvent.click(screen.getAllByRole('button', { name: /Iniciar$/ })[0])
  await waitFor(() => expect(screen.getByText('Iniciar ciclo 2027')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
}

describe('SchoolYearsPage · wizard de inicio (asignación de estudiantes)', () => {
  beforeEach(() => {
    mockedUseCtx.mockReset()
    mockedUseCtx.mockReturnValue(ctx({ activeId: null, years: [plannedYear] as never }))
    mockedApi.mockReset()
  })

  it('el paso Estudiantes muestra buscador, barra de acciones en bloque y filtra por búsqueda', async () => {
    await openStudentsStep()

    expect(screen.getByLabelText('Buscar estudiante')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pasa a todos' })).toBeInTheDocument()
    expect(screen.getByText('García, Ana')).toBeInTheDocument()
    expect(screen.getByText('Pérez, Beto')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar estudiante'), { target: { value: 'pérez' } })
    expect(screen.queryByText('García, Ana')).not.toBeInTheDocument()
    expect(screen.getByText('Pérez, Beto')).toBeInTheDocument()
  })

  it('"Egresa a todos" solo egresa al último ciclo; el resto pasa', async () => {
    await openStudentsStep()

    fireEvent.click(screen.getByRole('button', { name: 'Egresa a todos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByText('Cierres de matrícula')).toBeInTheDocument()
    // Beto está en 2do (último curso del plan): egresa. Ana está en 1ro: no puede egresar y pasa.
    expect(screen.getByText('Pérez, Beto')).toBeInTheDocument()
    expect(screen.getByText('Egresa')).toBeInTheDocument()
    expect(screen.queryByText('García, Ana')).not.toBeInTheDocument()
  })

  it('el último ciclo egresa por defecto y no ofrece "Pasa"; el resto no puede egresar', async () => {
    await openStudentsStep()

    // Botones de fila: Ana (1ro) ofrece "Pasa" y no "Egresa"; Beto (2do, último) al revés.
    expect(screen.getAllByRole('button', { name: 'Pasa' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Egresa' })).toHaveLength(1)
  })

  it('el resumen muestra el curso siguiente sugerido para quienes pasan', async () => {
    await openStudentsStep()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByText('Estudiantes por clase destino')).toBeInTheDocument()
    expect(screen.getByText('B · 2do')).toBeInTheDocument()
    expect(screen.queryByText('A · 1ro')).not.toBeInTheDocument()
  })

  it('Repite sugiere el mismo curso y permite cambiar el destino manualmente', async () => {
    await openStudentsStep()

    const destination = screen.getAllByLabelText('Curso destino')[0]
    expect(destination).toHaveValue('c2')

    fireEvent.click(screen.getAllByRole('button', { name: 'Repite' })[0])
    expect(destination).toHaveValue('c1')

    fireEvent.change(destination, { target: { value: 'c2' } })
    expect(destination).toHaveValue('c2')
  })
})
