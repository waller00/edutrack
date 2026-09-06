import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAcademicConfigPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const schoolYearContextMock = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => schoolYearContextMock.current,
}))
const mockedApi = vi.mocked(api)

const PERIODS = [
  {
    id: 'p1',
    schoolYearId: 'sy1',
    level: 'EBI',
    code: 'MARZO_ABRIL',
    name: 'Marzo – Abril',
    sortOrder: 20,
    startsOn: '2026-03-16',
    endsOn: '2026-04-30',
    closesOn: '2026-05-08',
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
    isActive: true,
  },
  {
    id: 'p2',
    schoolYearId: 'sy1',
    level: 'EMS',
    code: 'PRIMER_SEMESTRE',
    name: 'Primer semestre',
    sortOrder: 10,
    startsOn: '2026-03-01',
    endsOn: '2026-07-15',
    closesOn: null,
    requiresConceptualJudgement: false,
    requiresGeneralGrade: true,
    isActive: true,
  },
]

const SCALES = [
  {
    id: 's1',
    code: 'NUMERICA_1_10',
    name: 'Numérica 1 a 10',
    kind: 'NUMERIC',
    minValueHundredths: 100,
    maxValueHundredths: 1000,
    decimals: 0,
    description: 'Escala de EBI',
    isActive: true,
    sortOrder: 10,
    levels: [
      {
        id: 'l1',
        code: 'INSUFICIENTE',
        label: 'Insuficiente',
        descriptor: 'No alcanza los aprendizajes esperados.',
        minValueHundredths: 100,
        maxValueHundredths: 599,
        colorToken: 'red',
        iconToken: 'alert-triangle',
        isPassing: false,
        isAlert: true,
        sortOrder: 10,
      },
    ],
    gaps: [{ fromHundredths: 600, toHundredths: 1000 }],
  },
]

const ACTIVITY_TYPES = [
  { id: 'a1', code: 'ESCRITO', name: 'Escrito', description: null, scope: 'GLOBAL', isActive: true, sortOrder: 10 },
]

function routeApi() {
  mockedApi.mockImplementation(async (url: string) => {
    const path = String(url)
    if (path.includes('/periods')) return { data: PERIODS } as any
    if (path.includes('/scales')) return { data: SCALES } as any
    if (path.includes('/activity-types')) return { data: ACTIVITY_TYPES } as any
    return { data: [] } as any
  })
}

describe('AdminAcademicConfigPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    schoolYearContextMock.current = null
  })

  it('abre en Períodos y separa EBI de EMS', async () => {
    routeApi()
    render(<AdminAcademicConfigPage />)

    expect(await screen.findByText('Marzo – Abril')).toBeInTheDocument()
    expect(screen.getByText('Primer semestre')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'EBI' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'EMS' })).toBeInTheDocument()
  })

  it('muestra las fechas como día civil, sin corrimiento de zona', async () => {
    routeApi()
    render(<AdminAcademicConfigPage />)
    expect(await screen.findByText('16/03/2026 – 30/04/2026')).toBeInTheDocument()
  })

  it('pide los períodos acotados a un ciclo, nunca "todos los ciclos"', async () => {
    routeApi()
    schoolYearContextMock.current = { schoolYearQuery: 'allYears=1', schoolYearScopedQuery: 'schoolYearId=sy1' }
    render(<AdminAcademicConfigPage />)

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    const periodCall = mockedApi.mock.calls.find(([url]) => String(url).includes('/periods'))
    expect(String(periodCall?.[0])).toContain('schoolYearId=sy1')
    expect(String(periodCall?.[0])).not.toContain('allYears')
  })

  it('en Escalas avisa el tramo sin cubrir', async () => {
    routeApi()
    render(<AdminAcademicConfigPage />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Escalas' }))
    expect(await screen.findByText('Numérica 1 a 10')).toBeInTheDocument()
    expect(screen.getByText(/Sin cubrir/)).toBeInTheDocument()
    expect(screen.getByText(/6 a 10/)).toBeInTheDocument()
  })

  it('el nivel del semáforo se lee sin depender del color (RNF 7.2)', async () => {
    routeApi()
    render(<AdminAcademicConfigPage />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Escalas' }))
    // La etiqueta viaja como texto y el badge lleva el descriptor en el title.
    const badge = await screen.findByTitle(
      'Insuficiente — situación de alerta — No alcanza los aprendizajes esperados.',
    )
    expect(badge).toHaveTextContent('Insuficiente')
  })

  it('muestra el catálogo de tipos de actividad', async () => {
    routeApi()
    render(<AdminAcademicConfigPage />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Tipos de actividad' }))
    expect(await screen.findByText('Escrito')).toBeInTheDocument()
  })

  it('informa el error de carga en lugar de quedarse en blanco', async () => {
    mockedApi.mockRejectedValue(new Error('API 500'))
    render(<AdminAcademicConfigPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('API 500')
  })
})
