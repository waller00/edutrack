import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SchoolYearsPage from './page'
import { useAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useAdminSchoolYear: vi.fn() }))

const mockedUseCtx = vi.mocked(useAdminSchoolYear)

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
