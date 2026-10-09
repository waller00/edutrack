import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAnalyticsPage from './page'
import { api } from '@/lib/api/client'
import { getTodayYmdInUruguay } from '@/lib/forms/datetime-uy'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const scope = vi.hoisted(() => ({
  loading: false,
  selectedId: 'sy-2025',
  activeId: 'sy-2026',
  allYears: false,
  years: [
    { id: 'sy-2025', startsOn: '2025-03-01', endsOn: '2025-12-15' },
    { id: 'sy-2026', startsOn: '2026-03-01', endsOn: '2026-12-15' },
  ],
}))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => scope,
}))
vi.mock('@/components/charts/TrendLineChart', () => ({
  default: ({ points }: { points: unknown[] }) => (
    <div data-testid="trend-chart">{JSON.stringify(points)}</div>
  ),
}))
vi.mock('@/components/charts/BreakdownBarChart', () => ({
  default: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="breakdown-chart">{JSON.stringify(rows)}</div>
  ),
}))
vi.mock('@/components/charts/StatusDonutChart', () => ({
  default: () => <div data-testid="status-chart" />,
}))
const mockedApi = vi.mocked(api)
const kpis = {
  M1_PUNCTUALITY_pct: 90,
  M2_LATE_RATE_pct: 10,
  M4_AOP_pct: 8,
  M6_COVERAGE_CP_pct: 92,
  M8_HOURS_DELTA_pct: -4,
  PC_count: 2,
}
const data = {
  meta: {
    resolvedInstanceCount: 120,
    rangeFrom: '2025-03-01',
    rangeTo: '2025-12-15',
    generatedAt: '2025-12-16T15:00:00Z',
    roleFilter: null,
    eventTypeFilter: null,
  },
  kpis,
  series: {
    lateRateByPeriod: [{ period: '2025-03-01', value: 10 }],
    aopByPeriod: [{ period: '2025-03-01', value: 8 }],
  },
  seriesMulti: [{ period: '2025-03-01', lateRate: 10, aop: 8, coverage: 92 }],
  breakdowns: {
    byRole: [
      { label: 'Docentes', lateRatePct: 10, aopPct: 8, plannedCount: 120 },
    ],
    byEventType: [
      { label: 'Clases', lateRatePct: 10, aopPct: 8, plannedCount: 120 },
    ],
    byCourse: [
      { label: 'Primero', lateRatePct: 10, aopPct: 8, plannedCount: 120 },
    ],
  },
  comparison: {
    previousFrom: '2024-06-01',
    previousTo: '2025-02-28',
    current: kpis,
    previous: kpis,
    deltas: {
      ...kpis,
      M1_PUNCTUALITY_pct: 2,
      M2_LATE_RATE_pct: -2,
      M4_AOP_pct: 0,
      M6_COVERAGE_CP_pct: 0,
    },
  },
  topLists: {
    topRiskPeople: [
      {
        userId: 'u1',
        displayName: 'Ana Benítez',
        role: 'TEACHER',
        plannedCount: 20,
        lateCount: 2,
        absentNotJustifiedCount: 3,
        absentJustifiedCount: 1,
        riskScore: 8,
      },
    ],
    topRiskEvents: [
      {
        eventId: 'e1',
        title: 'Clase de Física',
        eventType: 'CLASE',
        plannedCount: 20,
        lateRatePct: 10,
        absentOverPlanPct: 15,
        focusScore: 25,
      },
    ],
  },
}
const users = [
  {
    id: 'u1',
    name: 'Ana Benítez',
    email: 'ana@example.edu',
    orgRole: { code: 'TEACHER' },
  },
  {
    id: 'u2',
    name: 'Pedro Silva',
    email: 'pedro@example.edu',
    orgRole: { code: 'STAFF' },
  },
]
const dashboards = () =>
  mockedApi.mock.calls.filter(([url]) =>
    String(url).startsWith('/analytics/dashboard'),
  )
const params = () =>
  new URL(String(dashboards().at(-1)?.[0]), 'http://localhost').searchParams
function respond(value: unknown = data) {
  mockedApi.mockImplementation(async (url) =>
    String(url).startsWith('/admin/users') ? { data: users } : value,
  )
}
async function loaded() {
  await screen.findByRole('heading', { name: 'Puntualidad' })
}
function applyDates(start: string, end: string) {
  fireEvent.click(screen.getByRole('button', { name: /^Período/ }))
  fireEvent.change(screen.getByLabelText('Fecha inicio'), {
    target: { value: start },
  })
  fireEvent.change(screen.getByLabelText('Fecha fin'), {
    target: { value: end },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
}

describe('Indicadores', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    scope.loading = false
    scope.selectedId = 'sy-2025'
    scope.activeId = 'sy-2026'
    scope.allYears = false
    scope.years = [
      { id: 'sy-2025', startsOn: '2025-03-01', endsOn: '2025-12-15' },
      { id: 'sy-2026', startsOn: '2026-03-01', endsOn: '2026-12-15' },
    ]
    respond()
  })

  it('abre cuatro indicadores y deja las cifras secundarias desplegables', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    expect(
      within(
        screen.getByRole('region', { name: 'Indicadores principales' }),
      ).getAllByRole('article'),
    ).toHaveLength(4)
    expect(
      screen.getByRole('heading', { name: 'Desvío de horas' }),
    ).not.toBeVisible()
    expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Personas para revisar' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('+2.00 p.p.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Más indicadores'))
    expect(
      screen.getByRole('heading', { name: 'Desvío de horas' }),
    ).toBeVisible()
  })

  it('consulta un ciclo cerrado desde la primera solicitud', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    expect(dashboards()).toHaveLength(1)
    expect(params().get('from')).toBe('2025-03-01')
    expect(params().get('to')).toBe('2025-12-15')
    expect(params().get('schoolYearId')).toBe('sy-2025')
    expect(params().get('granularity')).toBe('week')
  })

  it('combina rol y actividad y los identifica al cerrar filtros', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros' }))
    fireEvent.change(screen.getByLabelText('Rol'), {
      target: { value: 'TEACHER' },
    })
    fireEvent.change(screen.getByLabelText('Tipo de actividad'), {
      target: { value: 'CLASE' },
    })
    await waitFor(() => expect(params().get('eventType')).toBe('CLASE'))
    expect(params().get('role')).toBe('TEACHER')
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros (2)' }))
    expect(screen.getByText('Docentes · Clase')).toBeVisible()
  })

  it('busca sin acentos, elige con teclado y sustituye el rol', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros' }))
    fireEvent.change(screen.getByLabelText('Rol'), {
      target: { value: 'TEACHER' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Persona' }), {
      target: { value: 'benitez' },
    })
    expect(screen.getByRole('option', { name: /Ana Benítez/ })).toBeVisible()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Persona' }), {
      key: 'Enter',
    })
    await waitFor(() => expect(params().get('userId')).toBe('u1'))
    expect(params().has('role')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar persona' }))
    await waitFor(() => expect(params().has('userId')).toBe(false))
  })

  it('Escape cierra el selector sin modificar los filtros', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    fireEvent.focus(screen.getByRole('combobox', { name: 'Persona' }))
    expect(
      screen.getByRole('listbox', { name: 'Personas' }),
    ).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Persona' }), {
      key: 'Escape',
    })
    expect(
      screen.queryByRole('listbox', { name: 'Personas' }),
    ).not.toBeInTheDocument()
    expect(dashboards()).toHaveLength(1)
  })

  it('desde seguimiento abre el resumen de la persona elegida', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Seguimiento' }))
    expect(screen.getByText('Ausencias justificadas')).not.toBeVisible()
    fireEvent.click(screen.getByText('Ver cifras de Ana Benítez'))
    expect(screen.getByText('Ausencias justificadas')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Ver asistencias' }),
    ).toHaveAttribute('href', '/admin/attendance')
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver indicadores de Ana Benítez' }),
    )
    await loaded()
    expect(screen.getByRole('button', { name: 'Resumen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(params().get('userId')).toBe('u1')
  })

  it('cambia agrupación temporal y compara una dimensión a la vez', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Tendencias' }))
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      JSON.parse(screen.getByTestId('trend-chart').textContent ?? ''),
    ).toEqual(data.seriesMulti)
    expect(screen.getByTestId('status-chart')).not.toBeVisible()
    fireEvent.click(screen.getByText('Distribución de asistencias'))
    expect(screen.getByTestId('status-chart')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Comparar por'), {
      target: { value: 'byCourse' },
    })
    expect(
      JSON.parse(screen.getByTestId('breakdown-chart').textContent ?? ''),
    ).toEqual(data.breakdowns.byCourse)
    fireEvent.click(screen.getByRole('button', { name: 'Mes' }))
    await waitFor(() => expect(params().get('granularity')).toBe('month'))
    expect(await screen.findByRole('button', { name: 'Mes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('aplica las fechas juntas y limpiar vuelve al ciclo', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    applyDates('01/05/2025', '31/05/2025')
    await waitFor(() => expect(params().get('from')).toBe('2025-05-01'))
    expect(params().get('to')).toBe('2025-05-31')
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await waitFor(() => expect(params().get('from')).toBe('2025-03-01'))
    expect(params().get('to')).toBe('2025-12-15')
  })

  it('no consulta fechas incompletas ni muestra cifras anteriores', async () => {
    render(<AdminAnalyticsPage />)
    await loaded()
    const count = dashboards().length
    applyDates('01/05/2025', '')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Elegí el inicio y el fin',
    )
    expect(
      screen.queryByRole('heading', { name: 'Puntualidad' }),
    ).not.toBeInTheDocument()
    expect(dashboards()).toHaveLength(count)
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDisabled()
  })

  it('cambiar de ciclo actualiza el rango desde la primera consulta', async () => {
    const view = render(<AdminAnalyticsPage />)
    await loaded()
    scope.selectedId = 'sy-2026'
    view.rerender(<AdminAnalyticsPage />)
    await waitFor(() => expect(params().get('schoolYearId')).toBe('sy-2026'))
    expect(params().get('from')).toBe('2026-03-01')
    expect(params().get('to')).toBe(
      getTodayYmdInUruguay() < '2026-12-15'
        ? getTodayYmdInUruguay()
        : '2026-12-15',
    )
    expect(
      dashboards()
        .filter(([url]) => String(url).includes('sy-2026'))
        .every(([url]) => String(url).includes('from=2026-03-01')),
    ).toBe(true)
  })

  it('todos los ciclos usa el primer inicio y omite el ciclo individual', async () => {
    scope.allYears = true
    render(<AdminAnalyticsPage />)
    await loaded()
    expect(params().get('allYears')).toBe('1')
    expect(params().has('schoolYearId')).toBe(false)
    expect(params().get('from')).toBe('2025-03-01')
    expect(params().get('to')).toBe(getTodayYmdInUruguay())
  })

  it('espera a que cargue la selección de ciclo', async () => {
    scope.loading = true
    const view = render(<AdminAnalyticsPage />)
    expect(dashboards()).toHaveLength(0)
    scope.loading = false
    view.rerender(<AdminAnalyticsPage />)
    await loaded()
    expect(params().get('schoolYearId')).toBe('sy-2025')
  })

  it('una muestra vacía no se presenta como asistencia de cero por ciento', async () => {
    respond({ ...data, meta: { ...data.meta, resolvedInstanceCount: 0 } })
    render(<AdminAnalyticsPage />)
    expect(
      await screen.findByText(
        'No hay registros planificados para estos filtros.',
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Puntualidad' }),
    ).not.toBeInTheDocument()
  })

  it('permite reintentar una carga fallida', async () => {
    let fail = true
    mockedApi.mockImplementation(async (url) => {
      if (String(url).startsWith('/admin/users')) return { data: users }
      if (fail) {
        fail = false
        throw new Error('Sin conexión')
      }
      return data
    })
    render(<AdminAnalyticsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await loaded()
  })

  it('ignora una respuesta tardía de filtros anteriores', async () => {
    let resolveOld!: (value: typeof data) => void
    let first = true
    mockedApi.mockImplementation(async (url) => {
      if (String(url).startsWith('/admin/users')) return { data: users }
      if (first) {
        first = false
        return new Promise<typeof data>((resolve) => {
          resolveOld = resolve
        })
      }
      return { ...data, kpis: { ...kpis, M1_PUNCTUALITY_pct: 75 } }
    })
    render(<AdminAnalyticsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros' }))
    fireEvent.change(screen.getByLabelText('Rol'), {
      target: { value: 'STAFF' },
    })
    await loaded()
    expect(screen.getByText('75.00%')).toBeInTheDocument()
    await act(async () => {
      resolveOld(data)
    })
    expect(screen.getByText('75.00%')).toBeInTheDocument()
    expect(screen.queryByText('90.00%')).not.toBeInTheDocument()
  })
})
