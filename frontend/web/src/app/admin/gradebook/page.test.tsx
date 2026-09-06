import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminGradeBookPage from './page'
import AdminStudentFilePage from './students/[id]/page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => null }))
const mockedApi = vi.mocked(api)

const GROUPS = [
  { courseOfferingId: 'off-1', courseName: '3 EMS', courseOrientationId: 'co-1', orientationName: 'Ciencias de la Vida' },
  { courseOfferingId: 'off-1', courseName: '3 EMS', courseOrientationId: 'co-2', orientationName: 'Ciencia y Tecnología' },
]
const PERIODS = [{ id: 'p-1', name: 'Mayo' }]

const MATRIX = {
  group: { courseName: '3 EMS', schoolYear: { label: '2026' } },
  subjects: [
    { gradeBookId: 'gb-1', name: 'Matemática', teacher: 'Ana G', periodStatus: 'OPEN' },
    { gradeBookId: 'gb-2', name: 'Historia', teacher: null, periodStatus: null },
  ],
  students: [
    {
      studentId: 's1',
      lastName: 'Benítez',
      firstName: 'Ana',
      cells: [
        {
          gradeBookId: 'gb-1',
          valueHundredths: 300,
          conceptualJudgement: 'Debe reforzar.',
          descriptor: { label: 'Insuficiente', descriptor: 'No alcanza.', colorToken: 'red', iconToken: 'alert-triangle', isAlert: true },
          periodStatus: 'OPEN',
          pending: false,
        },
        { gradeBookId: 'gb-2', valueHundredths: null, conceptualJudgement: null, descriptor: null, periodStatus: null, pending: true },
      ],
      averageHundredths: 300,
      pendingCount: 1,
      alertCount: 1,
      atRisk: false,
    },
  ],
  averageLabel: 'Indicador automático / promedio orientativo',
}

function routeApi() {
  mockedApi.mockImplementation(async (url: string) => {
    const path = String(url)
    if (path.includes('/groups')) return { data: GROUPS } as any
    if (path.includes('/periods')) return { data: PERIODS } as any
    if (path.includes('/group-matrix')) return MATRIX as any
    return { data: [] } as any
  })
}

beforeEach(() => mockedApi.mockReset())

describe('AdminGradeBookPage', () => {
  it('ofrece un grupo por orientación', async () => {
    routeApi()
    render(<AdminGradeBookPage />)
    expect(await screen.findByRole('option', { name: '3 EMS — Ciencias de la Vida' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '3 EMS — Ciencia y Tecnología' })).toBeInTheDocument()
  })

  it('no pide la matriz hasta tener grupo y período', async () => {
    routeApi()
    render(<AdminGradeBookPage />)
    await screen.findByText(/Elegí un grupo y un período/)
    expect(mockedApi.mock.calls.some(([u]) => String(u).includes('group-matrix'))).toBe(false)
  })

  it('pide la matriz con la orientación del grupo elegido', async () => {
    routeApi()
    render(<AdminGradeBookPage />)
    await screen.findByRole('option', { name: '3 EMS — Ciencias de la Vida' })

    fireEvent.change(screen.getByLabelText('Grupo'), { target: { value: 'off-1::co-1' } })
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'p-1' } })

    await waitFor(() => {
      const call = mockedApi.mock.calls.find(([u]) => String(u).includes('group-matrix'))
      expect(String(call?.[0])).toContain('courseOrientationId=co-1')
    })
  })

  it('muestra la celda con símbolo además del color y el pendiente como guion', async () => {
    routeApi()
    render(<AdminGradeBookPage />)
    await screen.findByRole('option', { name: '3 EMS — Ciencias de la Vida' })
    fireEvent.change(screen.getByLabelText('Grupo'), { target: { value: 'off-1::co-1' } })
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'p-1' } })

    const cell = await screen.findByTitle('Insuficiente — Debe reforzar.')
    expect(cell).toHaveTextContent('3')
    expect(cell).toHaveTextContent('▲')
    expect(screen.getByTitle('Sin calificación del período')).toHaveTextContent('—')
  })

  it('rotula el promedio como indicador automático (RF-061)', async () => {
    routeApi()
    render(<AdminGradeBookPage />)
    await screen.findByRole('option', { name: '3 EMS — Ciencias de la Vida' })
    fireEvent.change(screen.getByLabelText('Grupo'), { target: { value: 'off-1::co-1' } })
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'p-1' } })

    expect(await screen.findByText(/No sustituye las decisiones pedagógicas/)).toBeInTheDocument()
  })
})

describe('AdminStudentFilePage', () => {
  const FILE = {
    student: { id: 's1', firstName: 'Ana', lastName: 'Benítez', documentId: '1.234.567-8', email: null },
    enrollments: [
      { schoolYearCode: 2026, schoolYearLabel: '2026', courseName: '3 EMS', orientationName: 'Cs. de la Vida', status: 'ACTIVE' },
    ],
    history: [],
    evolutionByYear: [
      {
        schoolYearCode: 2026,
        subjects: [
          {
            subjectName: 'Matemática',
            points: [
              { periodCode: 'P1', periodName: 'Uno', valueHundredths: 900 },
              { periodCode: 'P2', periodName: 'Dos', valueHundredths: null },
              { periodCode: 'P3', periodName: 'Tres', valueHundredths: 500 },
            ],
            sustainedDecline: true,
          },
        ],
      },
    ],
  }

  it('muestra identificación y trayectoria', async () => {
    mockedApi.mockResolvedValue(FILE as any)
    render(<AdminStudentFilePage params={{ id: 's1' }} />)

    expect(await screen.findByText('Benítez, Ana')).toBeInTheDocument()
    expect(screen.getByText('Cs. de la Vida', { exact: false })).toBeInTheDocument()
  })

  it('el período sin datos se muestra como hueco, no como cero', async () => {
    mockedApi.mockResolvedValue(FILE as any)
    render(<AdminStudentFilePage params={{ id: 's1' }} />)
    expect(await screen.findByTitle('Período sin datos')).toHaveTextContent('—')
  })

  it('marca el descenso sostenido', async () => {
    mockedApi.mockResolvedValue(FILE as any)
    render(<AdminStudentFilePage params={{ id: 's1' }} />)
    expect(await screen.findByText('Descenso sostenido')).toBeInTheDocument()
  })

  it('aclara que los indicadores no generan decisiones administrativas', async () => {
    mockedApi.mockResolvedValue(FILE as any)
    render(<AdminStudentFilePage params={{ id: 's1' }} />)
    expect(await screen.findByText(/No generan por sí solos decisiones administrativas/)).toBeInTheDocument()
  })
})
