import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EndorsementGrid, { bulkMessage, endorsementGridPath } from './EndorsementGrid'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const { authState } = vi.hoisted(() => ({ authState: { me: null as unknown } }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => authState }))

const grant = (...ids: string[]) => ({ permissions: ids.map((id) => ({ id, scope: 'all' })) })

const PERIODS = { data: [{ id: 'p-1', name: '1.ª Entrega' }] }
const GROUPS = {
  data: [{ courseOfferingId: 'off-1', courseName: '5.º', courseOrientationId: 'co-1', orientationName: 'Científico' }],
}

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    gradeBookPeriodId: id,
    gradeBookId: `gb-${id}`,
    periodStatus: 'CLOSED',
    period: { id: 'p-1', name: '1.ª Entrega' },
    subject: { name: `Materia ${id}` },
    teacher: { name: 'Ana G' },
    courseName: '5.º',
    orientationName: 'Científico',
    closedLate: false,
    sections: [],
    overallStatus: 'PENDING',
    pendingAgeDays: 3,
    blockingSections: [],
    canFinalize: true,
    reclosedAfterObservation: false,
    ...over,
  }
}

const ROWS = [
  row('lista'),
  row('observada', {
    canFinalize: false,
    blockingSections: ['GRADES'],
    sections: [{ section: 'GRADES', status: 'OBSERVED', occurredAt: null, observations: 'Falta una nota.' }],
    reclosedAfterObservation: true,
  }),
]

function respond(rows = ROWS) {
  mockedApi.mockImplementation((path: string, init?: RequestInit) => {
    const url = String(path)
    if (url.startsWith('/admin/gradebook/periods')) return Promise.resolve(PERIODS)
    if (url.startsWith('/admin/gradebook/groups')) return Promise.resolve(GROUPS)
    if (url === '/admin/gradebook/endorsements/bulk') return Promise.resolve({ endorsed: 1, skipped: [] })
    if (init?.method === 'POST') return Promise.resolve({ data: {} })
    if (url.startsWith('/admin/gradebook/endorsements/')) return Promise.resolve({ history: [] })
    return Promise.resolve({ data: rows })
  })
}

const lastGridCall = () =>
  mockedApi.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith('/admin/gradebook/endorsements') && !url.includes('/bulk'))
    .at(-1)

describe('<EndorsementGrid />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.me = grant('gradebook.read', 'gradebook.review')
    vi.stubGlobal('confirm', vi.fn(() => true))
    respond()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adscripción no ve "Visar": es atribución de Dirección', async () => {
    render(<EndorsementGrid />)
    expect(await screen.findByText('Materia lista')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Visar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Visar las/ })).toBeNull()
  })

  it('cada libreta se puede abrir antes de visarla', async () => {
    render(<EndorsementGrid />)
    const links = await screen.findAllByRole('link', { name: 'Abrir libreta' })
    expect(links[0]).toHaveAttribute('href', '/libreta/gb-lista/cierre')
  })

  it('marca lo que volvió a cerrarse después de la observación', async () => {
    render(<EndorsementGrid />)
    expect(await screen.findByText(/Volvió a cerrarse tras la observación/)).toBeInTheDocument()
  })

  it('filtra por reunión y por grupo con su orientación', async () => {
    render(<EndorsementGrid />)
    await screen.findByText('Materia lista')

    fireEvent.change(screen.getByLabelText('Reunión'), { target: { value: 'p-1' } })
    fireEvent.change(screen.getByLabelText('Grupo'), { target: { value: 'off-1::co-1' } })

    await waitFor(() =>
      expect(lastGridCall()).toBe(
        '/admin/gradebook/endorsements?pending=true&periodId=p-1&courseOfferingId=off-1&courseOrientationId=co-1',
      ),
    )
  })

  it('Dirección visa en lote sólo lo que está listo, con una reunión elegida', async () => {
    authState.me = grant('gradebook.read', 'gradebook.review', 'gradebook.endorse')
    render(<EndorsementGrid />)
    await screen.findByText('Materia lista')
    // Sin reunión elegida no se ofrece el lote: visar "todo el año" de un clic es demasiado.
    expect(screen.queryByRole('button', { name: /Visar las/ })).toBeNull()

    fireEvent.change(screen.getByLabelText('Reunión'), { target: { value: 'p-1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Visar las 1 listas' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/endorsements/bulk', {
        method: 'POST',
        body: JSON.stringify({ gradeBookPeriodIds: ['lista'] }),
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Se visó 1 libreta.')
  })

  it('el visado individual se deshabilita mientras haya secciones observadas', async () => {
    authState.me = grant('gradebook.read', 'gradebook.endorse')
    render(<EndorsementGrid />)
    await screen.findByText('Materia observada')
    const buttons = screen.getAllByRole('button', { name: 'Visar' })
    expect(buttons[0]).toBeEnabled()
    expect(buttons[1]).toBeDisabled()
  })

  it('abre el detalle de la fila con su historial', async () => {
    render(<EndorsementGrid />)
    fireEvent.click(await screen.findByRole('button', { name: 'Materia observada' }))
    expect(await screen.findByText('Historial')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/endorsements/observada')
    const detail = screen.getByText('Historial').closest('div') as HTMLElement
    expect(within(detail).getByText('Sin movimientos todavía.')).toBeInTheDocument()
  })
})

describe('auxiliares de la grilla', () => {
  it('arma la consulta sólo con los filtros elegidos', () => {
    expect(endorsementGridPath({ periodId: '', group: null, pendingOnly: false })).toBe('/admin/gradebook/endorsements')
    expect(
      endorsementGridPath({
        periodId: '',
        group: { courseOfferingId: 'off-1', courseName: '1.º', courseOrientationId: null, orientationName: null },
        pendingOnly: true,
      }),
    ).toBe('/admin/gradebook/endorsements?pending=true&courseOfferingId=off-1')
  })

  it('el resultado del lote dice cuántas quedaron afuera', () => {
    expect(bulkMessage({ endorsed: 3, skipped: [] })).toBe('Se visaron 3 libretas.')
    expect(bulkMessage({ endorsed: 2, skipped: [{ gradeBookPeriodId: 'x', code: 'SECTIONS_OBSERVED' }] })).toMatch(
      /^Se visaron 2 libretas\. Una no se visó/,
    )
  })
})
