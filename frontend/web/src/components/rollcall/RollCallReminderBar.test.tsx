import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RollCallReminderBar from './RollCallReminderBar'
import { ROLL_CALL_SAVED_EVENT, type RollCallClassRow } from '@/lib/rollcall/class-row'

const pathnameMock = vi.fn(() => '/')
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}))

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

/** Matemática de 3.º B, 10:00–10:45 en Uruguay (13:00–13:45 UTC): abre 09:50. */
function row(over: Partial<RollCallClassRow> = {}): RollCallClassRow {
  return {
    eventId: 'ev-1',
    ymd: '2026-10-08',
    title: 'Matemática',
    subject: 'Matemática',
    course: '3.º B',
    orientation: null,
    startAt: '2026-10-08T13:00:00.000Z',
    endAt: '2026-10-08T13:45:00.000Z',
    teacher: { id: 'ana', name: 'Ana Pérez' },
    substitute: null,
    isSubstitution: false,
    nonWorkingDay: null,
    rollCall: {
      sessionId: null,
      status: 'PENDING',
      takenAt: null,
      takenBy: null,
      rosterSize: null,
      canEdit: true,
      blockedReason: null,
      opensAt: '2026-10-08T12:50:00.000Z',
      editableUntil: '2026-10-10T13:45:00.000Z',
    },
    ...over,
  }
}

describe('<RollCallReminderBar />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.sessionStorage.clear()
    pathnameMock.mockReturnValue('/libreta')
    apiMock.mockResolvedValue({ items: [row()] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('en plena clase, sale arriba con la clase y el botón para pasar la lista', async () => {
    vi.setSystemTime(new Date('2026-10-08T13:10:00.000Z'))
    render(<RollCallReminderBar />)

    expect(await screen.findByText(/3\.º B · Matemática/)).toBeInTheDocument()
    expect(screen.getByText('Ahora:')).toBeInTheDocument()
    expect(screen.getByText('· 10:00–10:45')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pasar lista' })).toHaveAttribute('href', '/me/roll-call/ev-1/2026-10-08')
    expect(apiMock).toHaveBeenCalledWith('/student-attendance/reminder')
  })

  it('10 minutos antes ya aparece; antes, no', async () => {
    vi.setSystemTime(new Date('2026-10-08T12:45:00.000Z'))
    const { container } = render(<RollCallReminderBar />)
    await waitFor(() => expect(apiMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()

    vi.setSystemTime(new Date('2026-10-08T12:50:00.000Z'))
    render(<RollCallReminderBar />)
    expect(await screen.findByRole('link', { name: 'Pasar lista' })).toBeInTheDocument()
  })

  it('si la clase terminó sin lista, avisa en ámbar y se puede dejar para más tarde', async () => {
    vi.setSystemTime(new Date('2026-10-08T14:30:00.000Z'))
    apiMock.mockResolvedValue({ items: [row(), row({ eventId: 'ev-2', course: '4.º A' })] })
    const { container } = render(<RollCallReminderBar />)

    expect(await screen.findByText(/Quedó sin pasar la lista de 3\.º B · Matemática/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'y 1 más' })).toHaveAttribute('href', '/me/roll-call')

    fireEvent.click(screen.getByRole('button', { name: 'Más tarde' }))
    expect(container).toBeEmptyDOMElement()
    expect(Number(globalThis.sessionStorage.getItem('edutrack.rollcall.snoozedUntil'))).toBeGreaterThan(Date.now())
  })

  it('una clase abierta tiene prioridad; las atrasadas quedan como contador', async () => {
    vi.setSystemTime(new Date('2026-10-08T14:10:00.000Z'))
    apiMock.mockResolvedValue({
      items: [
        row(),
        row({
          eventId: 'ev-2',
          course: '4.º A',
          startAt: '2026-10-08T14:00:00.000Z',
          endAt: '2026-10-08T14:45:00.000Z',
          rollCall: { ...row().rollCall, opensAt: '2026-10-08T13:50:00.000Z' },
        }),
      ],
    })
    render(<RollCallReminderBar />)

    expect(await screen.findByText(/4\.º A · Matemática/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1 lista sin pasar' })).toHaveAttribute('href', '/me/roll-call')
    expect(screen.getByRole('link', { name: 'Pasar lista' })).toHaveAttribute('href', '/me/roll-call/ev-2/2026-10-08')
  })

  it('no sale en la planilla de esa misma clase ni en "Pase de lista"', async () => {
    vi.setSystemTime(new Date('2026-10-08T13:10:00.000Z'))
    pathnameMock.mockReturnValue('/me/roll-call/ev-1/2026-10-08')
    const { container, unmount } = render(<RollCallReminderBar />)
    await waitFor(() => expect(apiMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    unmount()

    pathnameMock.mockReturnValue('/me/roll-call')
    const second = render(<RollCallReminderBar />)
    expect(second.container).toBeEmptyDOMElement()
  })

  it('al guardar la lista, vuelve a preguntar y desaparece', async () => {
    vi.setSystemTime(new Date('2026-10-08T13:10:00.000Z'))
    const { container } = render(<RollCallReminderBar />)
    expect(await screen.findByRole('link', { name: 'Pasar lista' })).toBeInTheDocument()

    apiMock.mockResolvedValue({ items: [] })
    act(() => {
      globalThis.dispatchEvent(new Event(ROLL_CALL_SAVED_EVENT))
    })

    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(apiMock).toHaveBeenCalledTimes(2)
  })

  it('una respuesta sin lista no rompe nada', async () => {
    vi.setSystemTime(new Date('2026-10-08T13:10:00.000Z'))
    apiMock.mockResolvedValue({})
    const { container } = render(<RollCallReminderBar />)
    await waitFor(() => expect(apiMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
