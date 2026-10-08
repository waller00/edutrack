import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentFile, { judgementsByPeriod } from './StudentFile'
import { api } from '@/lib/api/client'
import { downloadFile } from '@/lib/api/download'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/lib/api/download', () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }))

const { authState } = vi.hoisted(() => ({ authState: { me: null as unknown } }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => authState }))

const mockedApi = vi.mocked(api)
const mockedDownload = vi.mocked(downloadFile)

const FILE = {
  student: { id: 'st-1', firstName: 'Ana', lastName: 'Díaz', documentId: '51234561', email: null },
  enrollments: [
    {
      schoolYearId: 'sy-1',
      schoolYearCode: 2026,
      schoolYearLabel: '2026',
      courseName: '5.º',
      orientationName: 'Científico',
      status: 'ACTIVE',
      absences: { absenceHundredths: 350, justified: 2 },
      conduct: [{ periodId: 'p-1', periodName: '1.er semestre', label: 'Buena' }],
      reportCardPeriods: [{ id: 'p-1', name: '1.er semestre' }],
    },
  ],
  history: [
    { subjectName: 'Matemática', periodName: '1.er semestre', periodSortOrder: 10, conceptualJudgement: 'Progresa bien.', schoolYearCode: 2026 },
    { subjectName: 'Historia', periodName: '1.er semestre', periodSortOrder: 10, conceptualJudgement: null, schoolYearCode: 2026 },
  ],
  evolutionByYear: [
    {
      schoolYearCode: 2026,
      subjects: [{ subjectName: 'Matemática', sustainedDecline: false, points: [{ periodCode: 'S1', periodName: '1.er semestre', valueHundredths: 800 }] }],
    },
  ],
  decisions: [
    { id: 'd-1', periodName: '1.er semestre', decision: 'Se cita a la familia.', createdAt: '2026-06-10T12:00:00.000Z', createdByName: 'Laura' },
  ],
}

describe('<StudentFile />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.me = { permissions: [{ id: 'gradebook.read', scope: 'all' }] }
    mockedApi.mockResolvedValue(FILE)
  })

  it('muestra la matrícula en castellano, las faltas y la conducta del año', async () => {
    render(<StudentFile studentId="st-1" />)
    expect(await screen.findByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('Faltas del ciclo: 3,5 (2 justificadas)')).toBeInTheDocument()
    expect(screen.getByText('Conducta: 1.er semestre Buena')).toBeInTheDocument()
  })

  it('muestra los juicios conceptuales y las decisiones de la reunión', async () => {
    render(<StudentFile studentId="st-1" />)
    expect(await screen.findByText('Juicios conceptuales')).toBeInTheDocument()
    expect(screen.getByText('Progresa bien.')).toBeInTheDocument()
    expect(screen.getByText('Se cita a la familia.')).toBeInTheDocument()
  })

  it('sin permiso de exportar no ofrece el boletín', async () => {
    render(<StudentFile studentId="st-1" />)
    await screen.findByText('Activa')
    expect(screen.queryByRole('button', { name: /Boletín/ })).toBeNull()
  })

  it('con permiso descarga el boletín de cada reunión', async () => {
    authState.me = { permissions: [{ id: 'gradebook.export', scope: 'all' }] }
    render(<StudentFile studentId="st-1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Boletín 1.er semestre' }))

    await waitFor(() =>
      expect(mockedDownload).toHaveBeenCalledWith('/admin/gradebook/report-card/st-1?periodId=p-1', 'boletin.pdf'),
    )
  })

  it('avisa si no puede cargar la ficha', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Estudiante no encontrado'))
    render(<StudentFile studentId="st-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Estudiante no encontrado')
  })
})

describe('judgementsByPeriod', () => {
  it('agrupa por período en el orden de la planilla y saltea los vacíos', () => {
    const groups = judgementsByPeriod(
      [
        { subjectName: 'Física', periodName: '2.º semestre', periodSortOrder: 20, conceptualJudgement: 'Bien.', schoolYearCode: 2026 },
        { subjectName: 'Química', periodName: '1.er semestre', periodSortOrder: 10, conceptualJudgement: '  ', schoolYearCode: 2026 },
        { subjectName: 'Biología', periodName: '1.er semestre', periodSortOrder: 10, conceptualJudgement: 'Muy bien.', schoolYearCode: 2026 },
        { subjectName: 'Otra', periodName: '1.er semestre', periodSortOrder: 10, conceptualJudgement: 'De otro año.', schoolYearCode: 2025 },
      ],
      2026,
    )
    expect(groups).toEqual([
      { periodName: '1.er semestre', items: [{ subjectName: 'Biología', text: 'Muy bien.' }] },
      { periodName: '2.º semestre', items: [{ subjectName: 'Física', text: 'Bien.' }] },
    ])
  })
})
