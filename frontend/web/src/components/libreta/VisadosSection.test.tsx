import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VisadosSection from './VisadosSection'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

vi.mock('@/contexts/LibretaContext', () => ({ useLibreta: () => ({ gradeBookId: 'gb-1' }) }))

function row(over: Record<string, unknown> = {}) {
  return {
    gradeBookPeriodId: 'gbp-1',
    gradeBookId: 'gb-1',
    periodStatus: 'CLOSED',
    period: { id: 'p-1', name: 'Mayo' },
    overallStatus: 'PENDING',
    blockingSections: ['GRADES'],
    canFinalize: false,
    reopenReason: null,
    sections: [
      { section: 'GRADES', status: 'OBSERVED', occurredAt: '2026-06-02T12:00:00Z', observations: 'Falta un alumno.' },
      { section: 'CLOSURE', status: 'PENDING', occurredAt: null, observations: null },
      { section: 'JUDGEMENTS', status: 'PENDING', occurredAt: null, observations: null },
      { section: 'ALL', status: 'PENDING', occurredAt: null, observations: null },
    ],
    history: [{ section: 'GRADES', status: 'OBSERVED', occurredAt: '2026-06-02T12:00:00Z', observations: 'Falta un alumno.', actorName: 'Laura' }],
    ...over,
  }
}

describe('<VisadosSection />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lee el visado de su propia libreta, no la grilla de supervisión', async () => {
    mockedApi.mockResolvedValue({ data: [row()] })
    render(<VisadosSection />)
    expect(await screen.findByText('Mayo')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-1/endorsements')
  })

  it('muestra qué le observaron, por sección', async () => {
    mockedApi.mockResolvedValue({ data: [row()] })
    render(<VisadosSection />)
    expect(await screen.findByText('Falta un alumno.')).toBeInTheDocument()
    expect(screen.getByText('Calificaciones')).toBeInTheDocument()
    expect(screen.getByText('Observado')).toBeInTheDocument()
    // La fila ALL es el agregado del período: ya se muestra arriba, no se repite en el detalle.
    expect(screen.queryByText('Período')).not.toBeInTheDocument()
  })

  it('un período reabierto para corregir sigue mostrando la observación y el motivo', async () => {
    mockedApi.mockResolvedValue({ data: [row({ periodStatus: 'REOPENED', reopenReason: 'Revisar el juicio de Benítez' })] })
    render(<VisadosSection />)
    expect(await screen.findByText(/Reabierto para corregir: Revisar el juicio de Benítez/)).toBeInTheDocument()
    expect(screen.getByText('Falta un alumno.')).toBeInTheDocument()
  })

  it('no lista reuniones abiertas sin historia de visado', async () => {
    mockedApi.mockResolvedValue({ data: [row({ periodStatus: 'OPEN', history: [], period: { id: 'p-2', name: 'Setiembre' } })] })
    render(<VisadosSection />)
    expect(await screen.findByText(/no hay nada para visar/)).toBeInTheDocument()
    expect(screen.queryByText('Setiembre')).not.toBeInTheDocument()
  })

  it('aclara que visar es de Dirección', async () => {
    mockedApi.mockResolvedValue({ data: [row()] })
    render(<VisadosSection />)
    expect(await screen.findByText(/Visar es atribución de Dirección/)).toBeInTheDocument()
  })

  it('avisa si no puede cargar el visado', async () => {
    mockedApi.mockRejectedValue(new Error('Libreta inaccesible'))
    render(<VisadosSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Libreta inaccesible')
  })
})
