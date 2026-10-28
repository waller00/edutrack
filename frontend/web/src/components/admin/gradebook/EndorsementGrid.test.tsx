import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EndorsementGrid, { bulkMessage, endorsementGridPath } from './EndorsementGrid'
import { api } from '@/lib/api/client'
import { endorsementAbilities } from '@/lib/gradebook/endorsements'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

type Props = ComponentProps<typeof EndorsementGrid>

const grant = (...ids: string[]) => ({ permissions: ids.map((id) => ({ id, scope: 'all' as const })) })

const ADSCRIPCION = endorsementAbilities(grant('gradebook.read', 'gradebook.review'))
const DIRECCION = endorsementAbilities(grant('gradebook.read', 'gradebook.review', 'gradebook.endorse'))

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

function renderGrid(over: Partial<Props> = {}) {
  const props: Props = {
    rows: ROWS as unknown as Props['rows'],
    loading: false,
    error: null,
    abilities: ADSCRIPCION,
    periodId: 'p-1',
    periodName: '1.ª Entrega',
    allMeetings: false,
    onAllMeetingsChange: vi.fn(),
    pendingOnly: true,
    onPendingOnlyChange: vi.fn(),
    onChanged: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
  render(<EndorsementGrid {...props} />)
  return props
}

describe('<EndorsementGrid />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('confirm', vi.fn(() => true))
    mockedApi.mockImplementation((path: string, init?: RequestInit) => {
      const url = String(path)
      if (url === '/admin/gradebook/endorsements/bulk') return Promise.resolve({ endorsed: 1, skipped: [] })
      if (init?.method === 'POST') return Promise.resolve({ data: {} })
      // El historial de la fila y los accesos a la libreta, que se piden al abrirla.
      return Promise.resolve({ history: [], data: [] })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adscripción no ve "Visar": es atribución de Dirección', () => {
    renderGrid()
    expect(screen.getByText('Materia lista')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Visar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Visar las/ })).toBeNull()
  })

  it('cada libreta se puede abrir antes de visarla', () => {
    renderGrid()
    expect(screen.getAllByRole('link', { name: 'Abrir libreta' })[0]).toHaveAttribute('href', '/libreta/gb-lista/cierre')
  })

  it('marca lo que volvió a cerrarse después de la observación', () => {
    renderGrid()
    expect(screen.getByText(/Volvió a cerrarse tras la observación/)).toBeInTheDocument()
  })

  it('los filtros propios del visado los maneja la pantalla', () => {
    const props = renderGrid()

    fireEvent.click(screen.getByLabelText('Sólo pendientes de visar'))
    fireEvent.click(screen.getByLabelText('Todas las reuniones'))

    expect(props.onPendingOnlyChange).toHaveBeenCalledWith(false)
    expect(props.onAllMeetingsChange).toHaveBeenCalledWith(true)
  })

  it('Dirección visa en lote sólo lo que está listo, y la pantalla recarga', async () => {
    const props = renderGrid({ abilities: DIRECCION })

    fireEvent.click(screen.getByRole('button', { name: 'Visar las 1 listas' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/endorsements/bulk', {
        method: 'POST',
        body: JSON.stringify({ gradeBookPeriodIds: ['lista'] }),
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Se visó 1 libreta.')
    expect(props.onChanged).toHaveBeenCalledTimes(1)
  })

  it('con todas las reuniones no se ofrece el lote: visar "todo el año" de un clic es demasiado', () => {
    renderGrid({ abilities: DIRECCION, allMeetings: true })
    expect(screen.getAllByRole('button', { name: 'Visar' })[0]).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Visar las/ })).toBeNull()
  })

  it('el visado individual se deshabilita mientras haya secciones observadas', () => {
    renderGrid({ abilities: endorsementAbilities(grant('gradebook.read', 'gradebook.endorse')) })
    const buttons = screen.getAllByRole('button', { name: 'Visar' })
    expect(buttons[0]).toBeEnabled()
    expect(buttons[1]).toBeDisabled()
  })

  it('abre el detalle de la fila con su historial', async () => {
    renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Materia observada' }))
    expect(await screen.findByText('Historial')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/endorsements/observada')
    const detail = screen.getByText('Historial').closest('div') as HTMLElement
    expect(within(detail).getByText('Sin movimientos todavía.')).toBeInTheDocument()
  })

  it('muestra el error de carga', () => {
    renderGrid({ rows: [], error: 'Sin permiso' })
    expect(screen.getByRole('alert')).toHaveTextContent('Sin permiso')
  })
})

describe('auxiliares de la grilla', () => {
  it('arma la consulta sólo con los filtros elegidos', () => {
    expect(endorsementGridPath({ periodId: '', group: null, pendingOnly: false })).toBe('/admin/gradebook/endorsements')
    expect(
      endorsementGridPath({ periodId: '', group: { courseOfferingId: 'off-1', courseOrientationId: null }, pendingOnly: true }),
    ).toBe('/admin/gradebook/endorsements?pending=true&courseOfferingId=off-1')
    expect(
      endorsementGridPath({ periodId: 'p-1', group: { courseOfferingId: 'off-1', courseOrientationId: 'co-1' }, pendingOnly: true }),
    ).toBe('/admin/gradebook/endorsements?pending=true&periodId=p-1&courseOfferingId=off-1&courseOrientationId=co-1')
  })

  it('el resultado del lote dice cuántas quedaron afuera', () => {
    expect(bulkMessage({ endorsed: 3, skipped: [] })).toBe('Se visaron 3 libretas.')
    expect(bulkMessage({ endorsed: 2, skipped: [{ gradeBookPeriodId: 'x', code: 'SECTIONS_OBSERVED' }] })).toMatch(
      /^Se visaron 2 libretas\. Una no se visó/,
    )
  })
})
