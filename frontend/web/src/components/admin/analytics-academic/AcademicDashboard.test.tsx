import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicDashboard, { availableLevels, dashboardQuery } from './AcademicDashboard'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  Cell: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))
const mockedApi = vi.mocked(api)

const DASHBOARD = {
  level: 'EBI',
  scale: { name: 'Numérica 1 a 10' },
  referencePeriod: { id: 'e1', name: '1.ª Entrega' },
  students: { total: 1, evaluated: 1, withoutAssessments: 0, atRisk: 0, improved: 0, declined: 0 },
  performance: { averageHundredths: 700, medianHundredths: 700, distribution: [], gradedCount: 1 },
  management: { gradeBooks: 1, complete: 1, incomplete: 0, pendingClosures: 0, pendingEndorsements: 0, endorsedPercentage: 0, lateClosures: 0, startedPercentage: 100 },
  disclaimer: 'No generan',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.mockImplementation((path: string) => {
    const url = String(path)
    if (url.startsWith('/admin/gradebook/periods')) {
      return Promise.resolve({ data: [{ id: 'e1', name: '1.ª Entrega', level: 'EBI' }, { id: 's1', name: '1.er semestre', level: 'EMS' }] } as never)
    }
    if (url.startsWith('/admin/academic-analytics/comparison')) return Promise.resolve({ data: [] } as never)
    return Promise.resolve(DASHBOARD as never)
  })
})

describe('<AcademicDashboard />', () => {
  it('pide los indicadores de un nivel y muestra contra qué reunión', async () => {
    render(<AcademicDashboard />)
    expect(await screen.findByText(/Notas de reunión \(R\) de 1\.ª Entrega/)).toBeInTheDocument()
    await waitFor(() =>
      expect(mockedApi.mock.calls.some(([p]) => String(p).startsWith('/admin/academic-analytics/dashboard?level=EBI'))).toBe(true),
    )
  })

  it('cambiar a bachillerato pide ese nivel', async () => {
    render(<AcademicDashboard />)
    fireEvent.click(await screen.findByRole('radio', { name: 'Bachillerato' }))
    await waitFor(() =>
      expect(mockedApi.mock.calls.some(([p]) => String(p).startsWith('/admin/academic-analytics/dashboard?level=EMS'))).toBe(true),
    )
  })
})

describe('auxiliares', () => {
  it('niveles con reuniones, o los dos sin datos', () => {
    expect(availableLevels([{ id: 'x', name: 'x', level: 'EMS' }])).toEqual(['EMS'])
    expect(availableLevels([])).toEqual(['EBI', 'EMS'])
    expect(dashboardQuery('EBI', 'p-1')).toBe('level=EBI&periodId=p-1')
  })
})
