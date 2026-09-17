import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VisadosSection from './VisadosSection'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

vi.mock('@/contexts/LibretaContext', () => ({ useLibreta: () => ({ gradeBookId: 'gb-1' }) }))

const PERIODS = {
  data: [
    { periodId: 'p-1', name: 'Mayo', status: 'CLOSED' },
    { periodId: 'p-2', name: 'Setiembre', status: 'OPEN' },
  ],
}

function endorsement(over: Record<string, unknown> = {}) {
  return {
    gradeBookPeriodId: 'gbp-1',
    gradeBookId: 'gb-1',
    period: { id: 'p-1', name: 'Mayo' },
    overallStatus: 'OBSERVED',
    blockingSections: [],
    sections: [
      { section: 'GRADES', status: 'OBSERVED', occurredAt: null, observations: 'Falta un alumno.' },
      { section: 'CLOSURE', status: 'PENDING', occurredAt: null, observations: null },
      { section: 'ALL', status: 'PENDING', occurredAt: null, observations: null },
    ],
    ...over,
  }
}

/** El componente pide la grilla y los períodos en paralelo, en ese orden. */
function respond(grid: unknown[], periods: unknown = PERIODS) {
  mockedApi.mockImplementation((path: string) =>
    Promise.resolve(String(path).includes('/endorsements') ? { data: grid } : periods),
  )
}

describe('<VisadosSection />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sólo lista los períodos cerrados', async () => {
    respond([endorsement()])

    render(<VisadosSection />)

    expect(await screen.findByText('Mayo')).toBeInTheDocument()
    expect(screen.queryByText('Setiembre')).not.toBeInTheDocument()
  })

  it('muestra el estado y las observaciones del período', async () => {
    respond([endorsement()])

    render(<VisadosSection />)

    // "Observado" aparece dos veces: el estado general del período y el de la sección observada.
    expect(await screen.findAllByText('Observado')).toHaveLength(2)
    expect(screen.getByText('Falta un alumno.')).toBeInTheDocument()
    expect(screen.getByText('Calificaciones')).toBeInTheDocument()
    // La fila ALL es el agregado del período: ya se muestra arriba, no se repite en el detalle.
    expect(screen.queryByText('Período')).not.toBeInTheDocument()
  })

  it('no toma el visado de otra libreta que comparte el nombre del período', async () => {
    // La grilla es de todo el ciclo: sin cruzar por libreta, "Mayo" de otro docente se colaría acá
    // con sus observaciones.
    respond([
      endorsement({
        gradeBookPeriodId: 'gbp-9',
        gradeBookId: 'gb-OTRA',
        overallStatus: 'ENDORSED',
        sections: [
          { section: 'GRADES', status: 'ENDORSED', occurredAt: null, observations: 'De otro docente.' },
        ],
      }),
    ])

    render(<VisadosSection />)

    expect(await screen.findByText('Mayo')).toBeInTheDocument()
    expect(screen.queryByText('De otro docente.')).not.toBeInTheDocument()
    expect(screen.queryByText('Visado')).not.toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('no confunde dos períodos distintos de la misma libreta', async () => {
    respond([endorsement({ period: { id: 'p-otro', name: 'Mayo' } })], {
      data: [{ periodId: 'p-1', name: 'Mayo', status: 'CLOSED' }],
    })

    render(<VisadosSection />)

    expect(await screen.findByText('Mayo')).toBeInTheDocument()
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.queryByText('Falta un alumno.')).not.toBeInTheDocument()
  })

  it('un período cerrado sin visado todavía figura como pendiente', async () => {
    respond([])

    render(<VisadosSection />)

    expect(await screen.findByText('Pendiente')).toBeInTheDocument()
  })

  it('explica que no hay nada para visar si no cerró ningún período', async () => {
    respond([], { data: [{ periodId: 'p-2', name: 'Setiembre', status: 'OPEN' }] })

    render(<VisadosSection />)

    expect(await screen.findByText(/no hay nada para visar/)).toBeInTheDocument()
  })

  it('aclara que visar es de Dirección', async () => {
    respond([endorsement()])

    render(<VisadosSection />)

    expect(await screen.findByText(/Visar es atribución de Dirección/)).toBeInTheDocument()
  })

  it('sigue mostrando los períodos aunque la grilla de visados no esté permitida', async () => {
    // El docente no tiene gradebook.review: la grilla da 403 y se ignora a propósito.
    mockedApi.mockImplementation((path: string) =>
      String(path).includes('/endorsements')
        ? Promise.reject(new Error('Sin permiso'))
        : Promise.resolve(PERIODS),
    )

    render(<VisadosSection />)

    expect(await screen.findByText('Mayo')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('avisa si no puede cargar los períodos', async () => {
    mockedApi.mockRejectedValue(new Error('Libreta inaccesible'))

    render(<VisadosSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Libreta inaccesible')
  })
})
