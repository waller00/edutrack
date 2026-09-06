import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicAnalyticsPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => null }))
// Recharts mide el contenedor con ResizeObserver, que jsdom no implementa.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts')
  return { ...actual, ResponsiveContainer: ({ children }: any) => <div style={{ width: 400, height: 200 }}>{children}</div> }
})
const mockedApi = vi.mocked(api)

const DASHBOARD = {
  students: { total: 20, evaluated: 18, withoutAssessments: 2, atRisk: 3, improved: 6, declined: 4 },
  performance: {
    averageHundredths: 680,
    medianHundredths: 700,
    gradedCount: 40,
    distribution: [
      { levelId: 'bajo', label: 'Insuficiente', colorToken: 'red', isAlert: true, count: 10, percentage: 25 },
      { levelId: 'alto', label: 'Logrado', colorToken: 'green', isAlert: false, count: 30, percentage: 75 },
    ],
  },
  management: {
    gradeBooks: 12, complete: 8, incomplete: 4, pendingClosures: 3,
    pendingEndorsements: 2, endorsedPercentage: 58.3, lateClosures: 1, startedPercentage: 92,
  },
  disclaimer: 'Las alertas tienen finalidad informativa. No generan automáticamente decisiones administrativas.',
}

const COMPARISON = [
  { key: 's-1', label: 'Matemática', averageHundredths: 570, medianHundredths: 600, gradedCount: 20, studentCount: 20, alertPercentage: 28 },
  { key: 's-2', label: 'Historia', averageHundredths: 710, medianHundredths: 700, gradedCount: 20, studentCount: 20, alertPercentage: 11 },
]

function routeApi() {
  mockedApi.mockImplementation(async (url: string) => {
    if (String(url).includes('/comparison')) return { data: COMPARISON } as any
    return DASHBOARD as any
  })
}

beforeEach(() => mockedApi.mockReset())

describe('AcademicAnalyticsPage', () => {
  it('muestra los tres bloques del pliego', async () => {
    routeApi()
    render(<AcademicAnalyticsPage />)

    expect(await screen.findByRole('heading', { name: 'Estudiantes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rendimiento' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Gestión de libretas' })).toBeInTheDocument()
  })

  it('muestra promedio y mediana por separado: no son lo mismo', async () => {
    routeApi()
    render(<AcademicAnalyticsPage />)
    await screen.findByRole('heading', { name: 'Rendimiento' })

    // Se acota a cada tarjeta: el mismo número puede repetirse en la comparativa.
    // El selector distingue la tarjeta (`<p>`) del encabezado de la tabla comparativa (`<th>`).
    const promedio = screen.getByText('Promedio general', { selector: 'p' }).parentElement!
    const mediana = screen.getByText('Mediana', { selector: 'p' }).parentElement!
    expect(within(promedio).getByText('6,8')).toBeInTheDocument()
    expect(within(mediana).getByText('7,0')).toBeInTheDocument()
  })

  it('la distribución también va como tabla: el gráfico no puede ser la única lectura', async () => {
    routeApi()
    render(<AcademicAnalyticsPage />)

    const row = await screen.findByRole('row', { name: /Insuficiente/ })
    expect(row).toHaveTextContent('10')
    expect(row).toHaveTextContent('25%')
    expect(row).toHaveTextContent('alerta')
  })

  it('cambiar la dimensión vuelve a pedir la comparativa', async () => {
    routeApi()
    render(<AcademicAnalyticsPage />)
    await screen.findByText('Matemática')

    fireEvent.change(screen.getByLabelText('Dimensión de comparación'), { target: { value: 'YEAR' } })

    await waitFor(() => {
      expect(mockedApi.mock.calls.some(([u]) => String(u).includes('dimension=YEAR'))).toBe(true)
    })
  })

  it('la comparativa muestra el % en alerta por asignatura (§5.5)', async () => {
    routeApi()
    render(<AcademicAnalyticsPage />)
    const row = await screen.findByRole('row', { name: /Matemática/ })
    expect(row).toHaveTextContent('28%')
  })

  it('lleva la aclaración de que las alertas no deciden solas', async () => {
    routeApi()
    render(<AcademicAnalyticsPage />)
    expect(await screen.findByText(/No generan automáticamente decisiones administrativas/)).toBeInTheDocument()
  })

  it('sin calificaciones explica el vacío en vez de dibujar un gráfico en blanco', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('/comparison')) return { data: [] } as any
      return { ...DASHBOARD, performance: { ...DASHBOARD.performance, gradedCount: 0, distribution: [] } } as any
    })
    render(<AcademicAnalyticsPage />)

    expect(await screen.findByText(/Todavía no hay calificaciones cerradas/)).toBeInTheDocument()
    expect(screen.getByText(/No hay calificaciones cerradas para comparar/)).toBeInTheDocument()
  })

  it('informa el error de carga', async () => {
    mockedApi.mockRejectedValue(new Error('API 500'))
    render(<AcademicAnalyticsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('API 500')
  })
})
