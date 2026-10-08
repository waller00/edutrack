import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EndorsementRowDetail from './EndorsementRowDetail'
import { api } from '@/lib/api/client'
import type { EndorsementAbilities, EndorsementRow } from '@/lib/gradebook/endorsements'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const ADSCRIPCION: EndorsementAbilities = { canObserve: true, canCorrect: true, canEndorse: false, canReopen: false }
const ADMINISTRACION: EndorsementAbilities = { canObserve: true, canCorrect: true, canEndorse: true, canReopen: true }
const INSPECCION: EndorsementAbilities = { canObserve: true, canCorrect: false, canEndorse: false, canReopen: false }

function row(over: Partial<EndorsementRow> = {}): EndorsementRow {
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
    ...over,
  }
}

const HISTORY = {
  history: [
    { section: 'CLOSURE', status: 'OBSERVED', occurredAt: '2026-06-02T12:00:00Z', observations: 'Falta cerrar a Benítez.', actor: { name: 'Laura Adscripta' } },
  ],
}

describe('<EndorsementRowDetail />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.mockImplementation((path: string) =>
      Promise.resolve(String(path).startsWith('/admin/gradebook/endorsements/') ? HISTORY : { data: {} }),
    )
  })

  it('muestra el historial con quién hizo cada cosa', async () => {
    render(<EndorsementRowDetail row={row()} abilities={ADSCRIPCION} onChanged={vi.fn()} />)
    expect(await screen.findByText(/Laura Adscripta/)).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/endorsements/gbp-1')
  })

  it('observa la sección elegida, no siempre Calificaciones', async () => {
    const onChanged = vi.fn()
    render(<EndorsementRowDetail row={row()} abilities={ADSCRIPCION} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Observar Calificaciones' }))
    fireEvent.change(screen.getByLabelText(/Qué hay que corregir en Calificaciones/), {
      target: { value: 'Falta la nota del escrito de abril.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar observación' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringContaining('Se observó Calificaciones')))
    expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/endorsements', {
      method: 'POST',
      body: JSON.stringify({
        gradeBookPeriodId: 'gbp-1',
        section: 'GRADES',
        status: 'OBSERVED',
        observations: 'Falta la nota del escrito de abril.',
      }),
    })
  })

  it('da por corregida una sección observada', async () => {
    const onChanged = vi.fn()
    render(<EndorsementRowDetail row={row()} abilities={ADSCRIPCION} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dar por corregido: Cierre' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/endorsements', {
      method: 'POST',
      body: JSON.stringify({ gradeBookPeriodId: 'gbp-1', section: 'CLOSURE', status: 'CORRECTED' }),
    })
  })

  it('adscripción no puede volver a observar una sección ya visada, ni reabrir', () => {
    render(<EndorsementRowDetail row={row()} abilities={ADSCRIPCION} onChanged={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Observar Juicios' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reabrir período/ })).toBeNull()
  })

  it('inspección observa pero no da por corregido', () => {
    render(<EndorsementRowDetail row={row()} abilities={INSPECCION} onChanged={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Observar Cierre' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Dar por corregido/ })).toBeNull()
  })

  it('administración reabre el período con motivo', async () => {
    const onChanged = vi.fn()
    render(<EndorsementRowDetail row={row()} abilities={ADMINISTRACION} onChanged={onChanged} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reabrir período para corregir' }))
    const confirm = screen.getByRole('button', { name: 'Reabrir' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Motivo de la reapertura/), { target: { value: 'Adscripción observó el cierre' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringContaining('Se reabrió 1.ª Entrega')))
    expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-1/periods/p-1/reopen', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Adscripción observó el cierre' }),
    })
  })

  it('muestra el error del servidor', async () => {
    mockedApi.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === 'POST' ? Promise.reject(new Error('El período no está cerrado.')) : Promise.resolve(HISTORY),
    )
    render(<EndorsementRowDetail row={row()} abilities={ADSCRIPCION} onChanged={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dar por corregido: Cierre' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El período no está cerrado.')
  })
})
