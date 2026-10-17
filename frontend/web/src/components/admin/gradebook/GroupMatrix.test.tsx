import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GroupMatrix, { conductText, isReportCardPeriod, reportCardsPath } from './GroupMatrix'
import { api } from '@/lib/api/client'
import { downloadFile } from '@/lib/api/download'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/lib/api/download', () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./MeetingDecisions', () => ({ default: () => <p>decisiones</p> }))

const { authState, nav } = vi.hoisted(() => ({
  authState: { me: null as unknown },
  nav: { replace: vi.fn(), search: '' },
}))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => authState }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/libreta/reunion',
  useSearchParams: () => new URLSearchParams(nav.search),
}))

const mockedApi = vi.mocked(api)
const mockedDownload = vi.mocked(downloadFile)

const grant = (...ids: string[]) => ({ permissions: ids.map((id) => ({ id, scope: 'all' })) })

const GROUPS = {
  data: [{ courseOfferingId: 'off-1', courseName: '5.º', courseOrientationId: 'co-1', orientationName: 'Científico', level: 'EMS' }],
}
const PERIODS = {
  data: [
    { id: 'p-1', name: '1.er semestre', level: 'EMS', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: true },
    { id: 'p-feb', name: 'Febrero', level: 'EMS', isMeeting: true, requiresGeneralGrade: true, requiresConceptualJudgement: false },
  ],
}
const CONDUCT_LEVELS = [
  { valueHundredths: 300, label: '3' },
  { valueHundredths: 400, label: '4' },
]

function matrix(over: Record<string, unknown> = {}) {
  return {
    group: { courseName: '5.º', schoolYear: { id: 'sy-1', label: '2026' } },
    subjects: [{ gradeBookId: 'gb-1', name: 'Matemática', teacher: 'Ana G', periodStatus: 'CLOSED' }],
    students: [
      {
        studentId: 'st-1',
        lastName: 'Díaz',
        firstName: 'Ana',
        cells: [{ gradeBookId: 'gb-1', valueHundredths: 800, conceptualJudgement: null, descriptor: null, periodStatus: 'CLOSED', pending: false }],
        averageHundredths: 800,
        conductValueHundredths: 300,
        absenceHundredths: 150,
        pendingCount: 0,
        alertCount: 0,
        atRisk: false,
      },
    ],
    averageLabel: 'Indicador automático / promedio orientativo',
    averageDecimals: 1,
    alertSubjectsThreshold: 3,
    conductLevels: CONDUCT_LEVELS,
    ...over,
  }
}

function respond(m = matrix()) {
  mockedApi.mockImplementation((path: string) => {
    const url = String(path)
    if (url.startsWith('/admin/gradebook/groups')) return Promise.resolve(GROUPS)
    if (url.startsWith('/admin/gradebook/periods')) return Promise.resolve(PERIODS)
    if (url.startsWith('/admin/gradebook/group-matrix')) return Promise.resolve(m)
    return Promise.resolve({ ok: true })
  })
}

async function openMatrix(periodId = 'p-1') {
  render(<GroupMatrix />)
  fireEvent.change(await screen.findByLabelText('Grupo'), { target: { value: 'off-1::co-1' } })
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: periodId } })
  await screen.findByText('Díaz, Ana')
}

describe('<GroupMatrix />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.me = grant('gradebook.read')
    nav.search = ''
    respond()
  })

  it('deja grupo y período en la URL, y la ficha vuelve a esta misma reunión', async () => {
    await openMatrix()
    const here = '/libreta/reunion?grupo=off-1%3A%3Aco-1&periodo=p-1'
    await waitFor(() => expect(nav.replace).toHaveBeenLastCalledWith(here, { scroll: false }))
    expect(screen.getByRole('link', { name: 'Díaz, Ana' })).toHaveAttribute(
      'href',
      `/libreta/estudiante/st-1?volver=${encodeURIComponent(here)}`,
    )
  })

  it('arranca con el grupo y el período que trae la URL', async () => {
    nav.search = 'grupo=off-1%3A%3Aco-1&periodo=p-1'
    render(<GroupMatrix />)
    expect(await screen.findByText('Díaz, Ana')).toBeInTheDocument()
    expect(screen.getByLabelText('Grupo')).toHaveValue('off-1::co-1')
    expect(screen.getByLabelText('Período')).toHaveValue('p-1')
  })

  it('pide la matriz del grupo con su orientación', async () => {
    await openMatrix()
    expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/group-matrix?courseOfferingId=off-1&periodId=p-1&courseOrientationId=co-1')
    expect(screen.getByText(/En alerta: 3 o más asignaturas/)).toBeInTheDocument()
  })

  it('sin permiso de control, la conducta se lee con el texto de la escala', async () => {
    await openMatrix()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByLabelText('Conducta de Díaz, Ana')).toBeNull()
  })

  it('adscripción carga la conducta institucional desde la matriz', async () => {
    authState.me = grant('gradebook.read', 'gradebook.review')
    await openMatrix()

    fireEvent.change(screen.getByLabelText('Conducta de Díaz, Ana'), { target: { value: '400' } })

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/conduct', {
        method: 'PUT',
        body: JSON.stringify({ schoolYearId: 'sy-1', periodId: 'p-1', entries: [{ studentId: 'st-1', valueHundredths: 400 }] }),
      }),
    )
    expect(screen.getByLabelText('Conducta de Díaz, Ana')).toHaveValue('400')
  })

  it('con permiso de exportar ofrece el boletín por alumno y el del grupo', async () => {
    authState.me = grant('gradebook.read', 'gradebook.export')
    await openMatrix()

    fireEvent.click(screen.getByRole('button', { name: 'Boletín de Díaz, Ana' }))
    await waitFor(() => expect(mockedDownload).toHaveBeenCalledWith('/admin/gradebook/report-card/st-1?periodId=p-1', 'boletin.pdf'))

    fireEvent.click(screen.getByRole('button', { name: 'Boletines del grupo' }))
    await waitFor(() =>
      expect(mockedDownload).toHaveBeenCalledWith(
        '/admin/gradebook/report-cards?courseOfferingId=off-1&periodId=p-1&courseOrientationId=co-1',
        'boletines.pdf',
      ),
    )
  })

  it('una reunión sin boletín (sin juicio) no ofrece boletines', async () => {
    authState.me = grant('gradebook.read', 'gradebook.export')
    await openMatrix('p-feb')
    expect(screen.queryByRole('button', { name: 'Boletines del grupo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Boletín de Díaz, Ana' })).toBeNull()
  })

  it('muestra el error de la descarga', async () => {
    authState.me = grant('gradebook.read', 'gradebook.export')
    mockedDownload.mockRejectedValueOnce(new Error('El grupo no tiene estudiantes matriculados'))
    await openMatrix()

    fireEvent.click(screen.getByRole('button', { name: 'Boletines del grupo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El grupo no tiene estudiantes matriculados')
  })
})

describe('auxiliares de la matriz', () => {
  it('reconoce la reunión de boletín', () => {
    expect(isReportCardPeriod(PERIODS.data[0] as never)).toBe(true)
    expect(isReportCardPeriod(PERIODS.data[1] as never)).toBe(false)
    expect(isReportCardPeriod(undefined)).toBe(false)
  })

  it('rotula la conducta con la escala o con el número', () => {
    expect(conductText(400, CONDUCT_LEVELS)).toBe('4')
    expect(conductText(null, CONDUCT_LEVELS)).toBe('—')
    expect(conductText(250, CONDUCT_LEVELS)).toBe('2,5')
  })

  it('arma la ruta de boletines con o sin orientación', () => {
    expect(
      reportCardsPath({ courseOfferingId: 'off-1', courseName: '1.º', courseOrientationId: null, orientationName: null }, 'p-1'),
    ).toBe('/admin/gradebook/report-cards?courseOfferingId=off-1&periodId=p-1')
  })
})
