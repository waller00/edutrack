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

describe('SchoolYearsPage · alta con herencia de la libreta', () => {
  beforeEach(() => {
    mockedUseCtx.mockReset()
    mockedApi.mockReset()
    // Sin ciclo activo el alta está habilitada y el acordeón se abre solo.
    mockedUseCtx.mockReturnValue(ctx({ activeId: null }))
  })

  const periodsSummary = {
    schoolYearCode: 2027,
    sourceSchoolYearCode: 2026,
    created: 16,
    existing: 0,
    byLevel: {
      EBI: { origin: 'SOURCE_YEAR', created: 12, existing: 0 },
      EMS: { origin: 'SOURCE_YEAR', created: 4, existing: 0 },
    },
  }

  it('sugiere el año siguiente y el ciclo anterior como origen', async () => {
    render(<SchoolYearsPage />)

    await waitFor(() => expect(screen.getByDisplayValue('2027')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Ciclo lectivo 2027')).toBeInTheDocument()
    const source = screen.getByLabelText('Ciclo origen de la libreta') as HTMLSelectElement
    expect(source.value).toBe('y1')
    expect(screen.getByRole('checkbox', { name: /Heredar los períodos de la libreta/ })).toBeChecked()
  })

  it('crea el ciclo heredando y cuenta los períodos en el mensaje', async () => {
    mockedApi.mockResolvedValue({ code: 2027, label: 'Ciclo lectivo 2027', academicPeriods: periodsSummary } as never)
    render(<SchoolYearsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('2027')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Crear ciclo/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    const [path, init] = mockedApi.mock.calls[0]
    expect(path).toBe('/admin/school-years')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      code: 2027,
      status: 'PLANNED',
      inheritAcademicPeriods: true,
      sourceSchoolYearId: 'y1',
    })
    expect(await screen.findByText(/Se cargaron 16 períodos del ciclo 2026/)).toBeInTheDocument()
  })

  it('al desmarcar la casilla no manda el ciclo origen', async () => {
    mockedApi.mockResolvedValue({ code: 2027, label: 'Ciclo lectivo 2027', academicPeriods: null } as never)
    render(<SchoolYearsPage />)
    await waitFor(() => expect(screen.getByDisplayValue('2027')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('checkbox', { name: /Heredar los períodos de la libreta/ }))
    expect(screen.getByLabelText('Ciclo origen de la libreta')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Crear ciclo/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    const body = JSON.parse(String(mockedApi.mock.calls[0][1]?.body))
    expect(body.inheritAcademicPeriods).toBe(false)
    expect(body).not.toHaveProperty('sourceSchoolYearId')
    expect(await screen.findByText(/Sin parametrización de libreta/)).toBeInTheDocument()
  })
})

