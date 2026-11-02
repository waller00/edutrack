import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VisadoDecision, { type DecisionRow } from './VisadoDecision'
import { api } from '@/lib/api/client'
import type { EndorsementAbilities } from '@/lib/gradebook/endorsements'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const ADSCRIPCION: EndorsementAbilities = { canObserve: true, canCorrect: true, canEndorse: false, canReopen: false }
const DIRECCION: EndorsementAbilities = { canObserve: true, canCorrect: true, canEndorse: true, canReopen: false }
const ADMINISTRACION: EndorsementAbilities = { canObserve: true, canCorrect: true, canEndorse: true, canReopen: true }
const INSPECCION: EndorsementAbilities = { canObserve: true, canCorrect: false, canEndorse: false, canReopen: false }

function row(over: Partial<DecisionRow> = {}): DecisionRow {
  return {
    gradeBookPeriodId: 'gbp-1',
    gradeBookId: 'gb-1',
    periodStatus: 'CLOSED',
    period: { id: 'p-1', name: '1.ª Entrega' },
    subject: { name: 'Matemática' },
    teacher: { name: 'Ana G' },
    courseName: '1.º',
    orientationName: null,
    closedLate: false,
    sections: [
      { section: 'GRADES', status: 'PENDING', occurredAt: null, observations: null },
      { section: 'CLOSURE', status: 'OBSERVED', occurredAt: '2026-06-02T12:00:00Z', observations: 'Falta cerrar a Benítez.' },
      { section: 'JUDGEMENTS', status: 'ENDORSED', occurredAt: '2026-06-03T12:00:00Z', observations: null },
      { section: 'ALL', status: 'PENDING', occurredAt: null, observations: null },
    ],
    overallStatus: 'PENDING',
    pendingAgeDays: 2,
    blockingSections: ['CLOSURE'],
    canFinalize: false,
    reopenReason: null,
    history: [
      {
        section: 'CLOSURE',
        status: 'OBSERVED',
        occurredAt: '2026-06-02T12:00:00Z',
        observations: 'Falta cerrar a Benítez.',
        actorName: 'Laura Adscripta',
      },
    ],
    ...over,
  }
}

const READY = row({
  sections: [],
  blockingSections: [],
  canFinalize: true,
  history: [],
})

const posted = () =>
  mockedApi.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([path, init]) => [path, JSON.parse(String((init as RequestInit).body))])

describe('<VisadoDecision />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.mockResolvedValue({ data: {} } as never)
  })

  it('Dirección visa lo que no tiene observaciones vivas', async () => {
    const onChanged = vi.fn()
    render(<VisadoDecision row={READY} abilities={DIRECCION} onChanged={onChanged} />)

    // En qué etapa está lo dice la línea de etapas de la revisión: acá va sólo la decisión.
    expect(screen.getByRole('heading', { name: '2. Tu decisión' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Visar 1.ª Entrega' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringContaining('Se visó 1.ª Entrega')))
    expect(posted()).toEqual([
      ['/admin/gradebook/endorsements', { gradeBookPeriodId: 'gbp-1', section: 'ALL', status: 'ENDORSED' }],
    ])
  })

  it('con una observación viva no deja visar y dice qué falta corregir', () => {
    render(<VisadoDecision row={row()} abilities={DIRECCION} onChanged={vi.fn()} />)
    const visar = screen.getByRole('button', { name: 'Visar 1.ª Entrega' })
    expect(visar).toBeDisabled()
    expect(visar).toHaveAttribute('title', 'Falta corregir: C y R del cierre')
    expect(screen.getByText('Para visarla, lo observado tiene que quedar corregido.')).toBeInTheDocument()
    const live = screen.getByRole('list', { name: 'Observaciones sin corregir' })
    expect(within(live).getByText('Falta cerrar a Benítez.')).toBeInTheDocument()
  })

  it('adscripción no ve "Visar": es atribución de Dirección', () => {
    render(<VisadoDecision row={READY} abilities={ADSCRIPCION} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Visar/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hacer una observación' })).toBeInTheDocument()
  })

  it('una observación dice sobre qué es y qué hay que corregir', async () => {
    const onChanged = vi.fn()
    render(<VisadoDecision row={row()} abilities={ADSCRIPCION} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Hacer una observación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar observación' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Elegí sobre qué es la observación.')

    fireEvent.change(screen.getByLabelText('¿Sobre qué?'), { target: { value: 'GRADES' } })
    fireEvent.change(screen.getByLabelText(/Qué hay que corregir/), { target: { value: 'Falta la nota del escrito de abril.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar observación' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringContaining('Se observó Notas de las evaluaciones')))
    expect(posted()).toEqual([
      [
        '/admin/gradebook/endorsements',
        { gradeBookPeriodId: 'gbp-1', section: 'GRADES', status: 'OBSERVED', observations: 'Falta la nota del escrito de abril.' },
      ],
    ])
  })

  it('adscripción no puede observar lo que ya visó Dirección', () => {
    render(<VisadoDecision row={row()} abilities={ADSCRIPCION} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hacer una observación' }))
    const options = within(screen.getByLabelText('¿Sobre qué?')).getAllByRole('option').map((o) => o.textContent)
    expect(options).not.toContain('Juicios')
    expect(options).toContain('Notas de las evaluaciones')
  })

  it('lo observado se da por corregido desde su aviso', async () => {
    const onChanged = vi.fn()
    render(<VisadoDecision row={row({ reclosedAfterObservation: true })} abilities={ADSCRIPCION} onChanged={onChanged} />)

    expect(screen.getByText(/volvió a cerrar: mirá si corrigió/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ya está corregido: C y R del cierre' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(posted()).toEqual([
      ['/admin/gradebook/endorsements', { gradeBookPeriodId: 'gbp-1', section: 'CLOSURE', status: 'CORRECTED' }],
    ])
  })

  it('inspección observa pero no da por corregido ni reabre', () => {
    render(<VisadoDecision row={row()} abilities={INSPECCION} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Hacer una observación' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ya está corregido/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reabrir/ })).toBeNull()
  })

  it('administración reabre el período con motivo', async () => {
    const onChanged = vi.fn()
    render(<VisadoDecision row={row()} abilities={ADMINISTRACION} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reabrir para que corrija' }))
    const confirm = screen.getByRole('button', { name: 'Reabrir' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Motivo de la reapertura/), { target: { value: 'Adscripción observó el cierre' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringContaining('Se reabrió 1.ª Entrega')))
    expect(posted()).toEqual([['/gradebook/gb-1/periods/p-1/reopen', { reason: 'Adscripción observó el cierre' }]])
  })

  it('reabierta, no hay nada que decidir hasta que el docente vuelva a cerrar', () => {
    render(
      <VisadoDecision
        row={row({ periodStatus: 'REOPENED', reopenReason: 'Completar el cierre' })}
        abilities={ADMINISTRACION}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByText(/reabierta para que el docente corrija: Completar el cierre/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Visar|Hacer una observación|Reabrir|Ya está corregido/ })).toBeNull()
  })

  it('visada: no ofrece visar de nuevo (la fecha la dice la línea de etapas)', () => {
    render(
      <VisadoDecision
        row={row({
          sections: [{ section: 'ALL', status: 'ENDORSED', occurredAt: '2026-06-10T12:00:00Z', observations: null }],
          overallStatus: 'ENDORSED',
          blockingSections: [],
          canFinalize: true,
        })}
        abilities={DIRECCION}
        onChanged={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /Visar/ })).toBeNull()
  })

  it('el historial queda plegado, con quién hizo cada cosa', () => {
    render(<VisadoDecision row={row()} abilities={ADSCRIPCION} onChanged={vi.fn()} />)
    expect(screen.getByText('Historial del visado')).toBeInTheDocument()
    expect(screen.getByText(/Laura Adscripta/)).toBeInTheDocument()
  })

  it('muestra el error del servidor', async () => {
    mockedApi.mockRejectedValue(new Error('El período no está cerrado.'))
    render(<VisadoDecision row={row()} abilities={ADSCRIPCION} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Ya está corregido: C y R del cierre' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El período no está cerrado.')
  })
})
