import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ControlVisadoPanel, { defaultMeeting, defaultStep, stepCounts, stepSummary } from './ControlVisadoPanel'
import { api } from '@/lib/api/client'
import { endorsementAbilities, type EndorsementRow } from '@/lib/gradebook/endorsements'
import type { MeetingPeriod } from '@/lib/gradebook/report-card-periods'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const { routerMock, state } = vi.hoisted(() => ({
  routerMock: { replace: vi.fn(), push: vi.fn() },
  state: {
    paso: null as string | null,
    permissions: [] as { id: string; scope: 'own' | 'all' }[],
    schoolYear: { loading: false, schoolYearScopedQuery: 'schoolYearId=sy-1' } as { loading: boolean; schoolYearScopedQuery: string } | null,
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/libreta/control',
  useSearchParams: () => ({ get: (key: string) => (key === 'paso' ? state.paso : null) }),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ me: { id: 'u-1', role: 'X', permissions: state.permissions } }),
}))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => state.schoolYear }))
// "Hoy" fijo: entre la 3.ª Entrega (ya pasó) y el 2.º semestre (la que viene).
vi.mock('@/lib/libreta/absence-day', () => ({ todayYmdUruguay: () => '2026-10-27' }))

const perms = (...ids: string[]) => ids.map((id) => ({ id, scope: 'all' as const }))
const ADSCRIPCION = perms('gradebook.read', 'gradebook.review')
const DIRECCION = perms('gradebook.read', 'gradebook.review', 'gradebook.endorse')
const SOLO_LECTURA = perms('gradebook.read')

const MEETINGS: MeetingPeriod[] = [
  { id: 'e3', name: '3.ª Entrega', level: 'EBI', closesOn: '2026-10-15', reportCard: true },
  { id: 'e4', name: '4.ª Entrega', level: 'EBI', closesOn: '2026-12-01', reportCard: true },
  { id: 's2', name: '2.º semestre', level: 'EMS', closesOn: '2026-11-20', reportCard: true },
  { id: 'exd', name: 'Exámenes diciembre', level: 'EMS', closesOn: '2026-12-15', reportCard: false },
]

const GROUPS = [
  { courseOfferingId: 'off-1', courseName: '1.º', courseOrientationId: null, orientationName: null, level: 'EBI' },
  { courseOfferingId: 'off-5', courseName: '5.º', courseOrientationId: 'co-1', orientationName: 'Científico', level: 'EMS' },
]

function controlRow(over: Record<string, unknown> = {}) {
  return {
    gradeBookId: 'gb-1',
    subjectName: 'Matemática',
    courseName: '1.º',
    teacherName: 'Ana Benítez',
    periodStatus: 'OPEN',
    rosterSize: 20,
    expectsAssessments: true,
    assessmentCount: 3,
    hasNoAssessments: false,
    missingAssessmentGrades: 2,
    requiresGrade: true,
    missingGrades: 0,
    requiresJudgement: true,
    missingJudgements: 0,
    complete: false,
    ...over,
  }
}

function endorsementRow(id: string, periodId: string, over: Record<string, unknown> = {}) {
  return {
    gradeBookPeriodId: id,
    gradeBookId: `gb-${id}`,
    periodStatus: 'CLOSED',
    period: { id: periodId, name: periodId },
    subject: { name: `Materia ${id}` },
    teacher: { name: 'Ana G' },
    courseName: '1.º',
    orientationName: null,
    closedLate: false,
    sections: [],
    overallStatus: 'PENDING',
    pendingAgeDays: 3,
    blockingSections: [],
    canFinalize: true,
    ...over,
  }
}

const CONTROL = [
  controlRow(),
  controlRow({ gradeBookId: 'gb-2', subjectName: 'Historia', complete: true, periodStatus: 'CLOSED' }),
]

const ENDORSEMENTS = [
  endorsementRow('lista', 'e3'),
  endorsementRow('observada', 'e3', { canFinalize: false, blockingSections: ['GRADES'] }),
  endorsementRow('vieja', 'e3-anterior'),
]

function respond() {
  mockedApi.mockImplementation((path: string, init?: RequestInit) => {
    const url = new URL(String(path), 'http://x')
    if (url.pathname === '/admin/gradebook/periods') return Promise.resolve({ data: MEETINGS } as never)
    if (url.pathname === '/admin/gradebook/groups') return Promise.resolve({ data: GROUPS } as never)
    if (url.pathname === '/admin/gradebook/completeness') return Promise.resolve({ data: CONTROL } as never)
    if (url.pathname === '/admin/gradebook/endorsements/bulk') return Promise.resolve({ endorsed: 1, skipped: [] } as never)
    if (init?.method === 'POST') return Promise.resolve({ data: {} } as never)
    if (url.pathname === '/admin/gradebook/endorsements') {
      const periodId = url.searchParams.get('periodId')
      return Promise.resolve({ data: ENDORSEMENTS.filter((row) => !periodId || row.period.id === periodId) } as never)
    }
    return Promise.resolve({ history: [], data: [] } as never)
  })
}

const calls = (pathname: string) =>
  mockedApi.mock.calls.map(([path]) => String(path)).filter((path) => new URL(path, 'http://x').pathname === pathname)

const meetingSelect = () => screen.getByLabelText('Reunión') as HTMLSelectElement
const groupSelect = () => screen.getByLabelText('Grupo') as HTMLSelectElement

beforeEach(() => {
  vi.clearAllMocks()
  state.paso = null
  state.permissions = ADSCRIPCION
  state.schoolYear = { loading: false, schoolYearScopedQuery: 'schoolYearId=sy-1' }
  vi.stubGlobal('confirm', vi.fn(() => true))
  respond()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<ControlVisadoPanel />', () => {
  it('adscripción abre en Carga con la próxima reunión de boletín, por nivel', async () => {
    render(<ControlVisadoPanel />)

    expect(await screen.findByRole('tab', { name: /Carga/ })).toHaveAttribute('aria-selected', 'true')
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveTextContent('1. Carga')
    expect(tabs[1]).toHaveTextContent('2. Cierre')
    expect(tabs[2]).toHaveTextContent('3. Visado')
    expect(meetingSelect().value).toBe('s2')
    expect(screen.getByRole('group', { name: 'Ciclo básico' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Bachillerato' })).toBeInTheDocument()
    await waitFor(() => expect(calls('/admin/gradebook/completeness')).toEqual(['/admin/gradebook/completeness?periodId=s2']))
  })

  it('cada paso dice cuánto le queda en la reunión elegida', async () => {
    render(<ControlVisadoPanel />)
    fireEvent.change(await screen.findByLabelText('Reunión'), { target: { value: 'e3' } })

    await waitFor(() => expect(screen.getByRole('tab', { name: /Carga/ })).toHaveTextContent('1 con faltantes'))
    expect(screen.getByRole('tab', { name: /Cierre/ })).toHaveTextContent('1 sin cerrar')
    // La de otra reunión no cuenta: sólo las de la 3.ª Entrega.
    expect(screen.getByRole('tab', { name: /Visado/ })).toHaveTextContent('1 para visar · 1 observada')
  })

  it('Dirección abre en Visado con la última reunión que pasó', async () => {
    state.permissions = DIRECCION
    render(<ControlVisadoPanel />)

    expect(await screen.findByRole('tab', { name: /Visado/ })).toHaveAttribute('aria-selected', 'true')
    expect(meetingSelect().value).toBe('e3')
    expect(await screen.findByText('Materia lista')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Visar las 1 listas' })).toBeInTheDocument()
  })

  it('el enlace viejo de Visado abre en ese paso', async () => {
    state.paso = 'visado'
    render(<ControlVisadoPanel />)

    expect(await screen.findByRole('tab', { name: /Visado/ })).toHaveAttribute('aria-selected', 'true')
    expect(meetingSelect().value).toBe('e3')
  })

  it('cambiar de paso lo deja en la URL', async () => {
    render(<ControlVisadoPanel />)
    fireEvent.click(await screen.findByRole('tab', { name: /Cierre/ }))
    expect(routerMock.replace).toHaveBeenCalledWith('/libreta/control?paso=cierre', { scroll: false })
  })

  it('una reunión que no es de boletín sólo tiene visado', async () => {
    render(<ControlVisadoPanel />)
    fireEvent.change(await screen.findByLabelText('Reunión'), { target: { value: 'exd' } })

    expect(await screen.findByText(/no es una reunión de boletín/)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Visado' })).toBeInTheDocument()
    expect(calls('/admin/gradebook/completeness').some((path) => path.includes('exd'))).toBe(false)
  })

  it('sin gradebook.review sólo hay visado, y el control no se pide', async () => {
    state.permissions = SOLO_LECTURA
    render(<ControlVisadoPanel />)

    expect(await screen.findByRole('tabpanel', { name: 'Visado' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    await waitFor(() => expect(calls('/admin/gradebook/endorsements').length).toBeGreaterThan(0))
    expect(calls('/admin/gradebook/completeness')).toEqual([])
  })

  it('el grupo filtra los tres pasos y sólo se ofrecen los del nivel de la reunión', async () => {
    render(<ControlVisadoPanel />)
    await screen.findByLabelText('Grupo')

    // 2.º semestre es de bachillerato: el 1.º de ciclo básico no aparece.
    expect(within(groupSelect()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos', '5.º — Científico'])
    fireEvent.change(groupSelect(), { target: { value: 'off-5::co-1' } })

    await waitFor(() =>
      expect(calls('/admin/gradebook/completeness')).toContain(
        '/admin/gradebook/completeness?periodId=s2&courseOfferingId=off-5&courseOrientationId=co-1',
      ),
    )
    expect(calls('/admin/gradebook/endorsements')).toContain(
      '/admin/gradebook/endorsements?pending=true&periodId=s2&courseOfferingId=off-5&courseOrientationId=co-1&schoolYearId=sy-1',
    )
  })

  it('pasar a una reunión de otro nivel suelta el grupo', async () => {
    render(<ControlVisadoPanel />)
    fireEvent.change(await screen.findByLabelText('Grupo'), { target: { value: 'off-5::co-1' } })
    expect(groupSelect().value).toBe('off-5::co-1')

    fireEvent.change(meetingSelect(), { target: { value: 'e3' } })
    expect(groupSelect().value).toBe('')
    await waitFor(() => expect(screen.queryAllByText('Revisando…')).toHaveLength(0))
  })

  it('"Todas las reuniones" pide el visado sin reunión', async () => {
    state.permissions = DIRECCION
    render(<ControlVisadoPanel />)
    fireEvent.click(await screen.findByLabelText('Todas las reuniones'))

    await waitFor(() =>
      expect(calls('/admin/gradebook/endorsements').at(-1)).toBe('/admin/gradebook/endorsements?pending=true&schoolYearId=sy-1'),
    )
    expect(await screen.findByText('Materia vieja')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Visar las/ })).toBeNull()
  })

  it('visar recuenta también el control: reabrir devuelve la libreta a Cierre', async () => {
    state.permissions = DIRECCION
    render(<ControlVisadoPanel />)
    await waitFor(() => expect(calls('/admin/gradebook/completeness')).toHaveLength(1))

    fireEvent.click(await screen.findByRole('button', { name: 'Visar las 1 listas' }))

    await waitFor(() => expect(calls('/admin/gradebook/completeness')).toHaveLength(2))
  })

  it('espera al ciclo lectivo antes de pedir nada', async () => {
    state.schoolYear = { loading: true, schoolYearScopedQuery: '' }
    const { rerender } = render(<ControlVisadoPanel />)

    expect(screen.getByText('Cargando reuniones…')).toBeInTheDocument()
    expect(mockedApi).not.toHaveBeenCalled()

    state.schoolYear = { loading: false, schoolYearScopedQuery: 'schoolYearId=sy-1' }
    rerender(<ControlVisadoPanel />)

    await waitFor(() => expect(calls('/admin/gradebook/periods')).toEqual(['/admin/gradebook/periods?schoolYearId=sy-1']))
  })

  it('sin reuniones en el ciclo lo dice', async () => {
    mockedApi.mockImplementation(() => Promise.resolve({ data: [] } as never))
    render(<ControlVisadoPanel />)
    expect(await screen.findByText(/Este ciclo no tiene reuniones/)).toBeInTheDocument()
  })
})

describe('auxiliares de control y visado', () => {
  it('Dirección, que visa y no reabre, abre en Visado; Administración y Adscripción, en Carga', () => {
    expect(defaultStep(endorsementAbilities({ permissions: DIRECCION }))).toBe('visado')
    expect(defaultStep(endorsementAbilities({ permissions: ADSCRIPCION }))).toBe('carga')
    expect(defaultStep(endorsementAbilities({ permissions: perms('gradebook.endorse', 'gradebook.manage') }))).toBe('carga')
  })

  it('para cargar, la reunión que viene; para cerrar o visar, la última que pasó', () => {
    expect(defaultMeeting(MEETINGS, 'carga', '2026-10-27')?.id).toBe('s2')
    expect(defaultMeeting(MEETINGS, 'cierre', '2026-10-27')?.id).toBe('e3')
    expect(defaultMeeting(MEETINGS, 'visado', '2026-10-27')?.id).toBe('e3')
  })

  it('el resumen de cada paso dice qué falta, no sólo cuánto', () => {
    const none = { carga: 0, cierre: 0, ready: 0, observed: 0 }
    expect(stepSummary('carga', none)).toBe('Al día')
    expect(stepSummary('cierre', { ...none, cierre: 3 })).toBe('3 sin cerrar')
    expect(stepSummary('visado', none)).toBe('Nada pendiente')
    expect(stepSummary('visado', { ...none, observed: 2 })).toBe('2 observadas')
  })

  it('el visado cuenta sólo la reunión elegida y no las ya visadas', () => {
    const rows = [
      endorsementRow('a', 'e3'),
      endorsementRow('b', 'e3', { overallStatus: 'ENDORSED' }),
      endorsementRow('c', 'e2'),
    ] as unknown as EndorsementRow[]
    expect(stepCounts([], rows, 'e3')).toEqual({ carga: 0, cierre: 0, ready: 1, observed: 0 })
  })
})
