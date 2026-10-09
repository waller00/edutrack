import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OccurrenceRollCallBox, { rollCallCountsLine } from './OccurrenceRollCallBox'

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

function status(over: Record<string, unknown> = {}) {
  return {
    eventId: 'ev-1',
    ymd: '2026-10-08',
    startAt: '2026-10-08T13:00:00.000Z',
    endAt: '2026-10-08T13:45:00.000Z',
    opensAt: '2026-10-08T12:50:00.000Z',
    teacher: { id: 'ana', name: 'Ana Pérez' },
    substitute: null,
    nonWorkingDay: null,
    rollCall: {
      status: 'PENDING',
      takenAt: null,
      takenBy: null,
      rosterSize: null,
      counts: { PRESENT: 0, LATE: 0, ABSENT: 0, ABSENT_JUSTIFIED: 0 },
    },
    ...over,
  }
}

describe('<OccurrenceRollCallBox />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z'))
  })

  it('lista pasada: docente, suplente, quién la pasó y qué dejó', async () => {
    apiMock.mockResolvedValue(
      status({
        substitute: { id: 'juan', name: 'Juan Gómez' },
        rollCall: {
          status: 'TAKEN',
          takenAt: '2026-10-08T13:07:00.000Z',
          takenBy: 'Juan Gómez',
          rosterSize: 25,
          counts: { PRESENT: 20, LATE: 2, ABSENT: 2, ABSENT_JUSTIFIED: 1 },
        },
      }),
    )

    render(<OccurrenceRollCallBox eventId="ev-1" ymd="2026-10-08" canOpen />)

    expect(await screen.findByText('Docente: Ana Pérez · Suplente: Juan Gómez')).toBeInTheDocument()
    expect(screen.getByText('Lista pasada 10:07 · Juan Gómez')).toBeInTheDocument()
    expect(screen.getByText('20 presentes · 2 tardes · 3 ausentes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir lista' })).toHaveAttribute('href', '/me/roll-call/ev-1/2026-10-08')
    expect(apiMock).toHaveBeenCalledWith('/admin/student-attendance/sessions/ev-1/2026-10-08/status')
  })

  it('sin lista y sin permiso para pasarla: dice que falta, sin enlace', async () => {
    apiMock.mockResolvedValue(status())

    render(<OccurrenceRollCallBox eventId="ev-1" ymd="2026-10-08" canOpen={false} />)

    expect(await screen.findByText('Lista sin pasar')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Abrir lista' })).not.toBeInTheDocument()
  })

  it('si el servidor no la encuentra, lo dice', async () => {
    apiMock.mockRejectedValue(new Error('La clase no se dicta ese día.'))
    render(<OccurrenceRollCallBox eventId="ev-1" ymd="2026-10-08" canOpen />)
    expect(await screen.findByText('La clase no se dicta ese día.')).toBeInTheDocument()
  })

  it('cuenta en singular y plural', () => {
    expect(rollCallCountsLine({ PRESENT: 1, LATE: 0, ABSENT: 1, ABSENT_JUSTIFIED: 0 })).toBe(
      '1 presente · 0 tardes · 1 ausente',
    )
  })
})
