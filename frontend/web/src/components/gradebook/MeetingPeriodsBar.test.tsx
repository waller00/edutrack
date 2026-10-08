import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MeetingPeriodsBar from './MeetingPeriodsBar'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const { authState } = vi.hoisted(() => ({ authState: { me: null as unknown } }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => authState }))

const PERIODS = {
  data: [
    { periodId: 'p-1', name: '1.ª Entrega', kind: 'ENTREGA', isMeeting: true, status: 'CLOSED' },
    { periodId: 'p-2', name: '2.ª Entrega', kind: 'ENTREGA', isMeeting: true, status: 'REOPENED' },
    { periodId: 't-1', name: 'Marzo-Abril', kind: 'TRAMO', isMeeting: false, status: 'CLOSED' },
  ],
}

describe('<MeetingPeriodsBar />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.me = null
    mockedApi.mockImplementation((path: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'POST' ? { coveredPeriodCodes: ['MAR-ABR'] } : PERIODS),
    )
  })

  it('una reunión reabierta se lee "reabierta" y el docente la puede volver a cerrar', async () => {
    render(<MeetingPeriodsBar gradeBookId="gb-1" canClose />)
    expect(await screen.findByText('reabierta')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
    // Los tramos no son reuniones: no aparecen en la barra.
    expect(screen.queryByText('Marzo-Abril')).toBeNull()
  })

  it('sin gradebook.manage no se ofrece reabrir', async () => {
    authState.me = { permissions: [{ id: 'gradebook.close', scope: 'own' }] }
    render(<MeetingPeriodsBar gradeBookId="gb-1" canClose />)
    await screen.findByText('1.ª Entrega')
    expect(screen.queryByRole('button', { name: 'Reabrir' })).toBeNull()
  })

  it('administración reabre una reunión cerrada con motivo', async () => {
    authState.me = { permissions: [{ id: 'gradebook.manage', scope: 'all' }] }
    const onChanged = vi.fn()
    render(<MeetingPeriodsBar gradeBookId="gb-1" canClose={false} onChanged={onChanged} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const confirm = screen.getByRole('button', { name: 'Reabrir' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo para reabrir 1.ª Entrega'), { target: { value: 'Corregir el juicio' } })
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-1/periods/p-1/reopen', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Corregir el juicio' }),
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Se reabrió 1.ª Entrega y sus tramos. El docente recibió el aviso.')
    expect(onChanged).toHaveBeenCalled()
  })
})
