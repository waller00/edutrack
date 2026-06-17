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

  it('la acción en bloque "Egresa a todos" se refleja en los cierres del resumen', async () => {
    await openStudentsStep()

    fireEvent.click(screen.getByRole('button', { name: 'Egresa a todos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByText('Cierres de matrícula')).toBeInTheDocument()
    expect(screen.getByText('García, Ana')).toBeInTheDocument()
    expect(screen.getByText('Pérez, Beto')).toBeInTheDocument()
    expect(screen.getAllByText('Egresa').length).toBeGreaterThanOrEqual(2)
  })

  it('el resumen muestra el conteo por clase destino', async () => {
    await openStudentsStep()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    expect(screen.getByText('Estudiantes por clase destino')).toBeInTheDocument()
    expect(screen.getByText('A · 1ro')).toBeInTheDocument()
    expect(screen.getByText('B · 2do')).toBeInTheDocument()
  })
})
