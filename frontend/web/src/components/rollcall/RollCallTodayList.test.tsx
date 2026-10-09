import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RollCallTodayList from './RollCallTodayList'
import type { RollCallClassRow } from '@/lib/rollcall/class-row'

const replaceMock = vi.fn()
let searchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => '/me/roll-call',
  useSearchParams: () => searchParams,
}))

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ me: { id: 'ana' } }),
}))

type RowOverrides = Omit<Partial<RollCallClassRow>, 'rollCall'> & { rollCall?: Partial<RollCallClassRow['rollCall']> }

function row(over: RowOverrides = {}): RollCallClassRow {
  const { rollCall, ...rest } = over
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
    ...rest,
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
      ...rollCall,
    },
  }
}

describe('<RollCallTodayList />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    vi.setSystemTime(new Date('2026-10-08T13:10:00.000Z')) // jueves 10:10 en Uruguay
    apiMock.mockResolvedValue([])
  })

  it('ordena el día en "Ahora", "Más tarde" y "Terminadas"', async () => {
    apiMock.mockResolvedValue([
      row({
        eventId: 'ev-0',
        course: '1.º A',
        startAt: '2026-10-08T11:00:00.000Z',
        endAt: '2026-10-08T11:45:00.000Z',
        rollCall: { status: 'TAKEN', takenAt: '2026-10-08T11:07:00.000Z', opensAt: '2026-10-08T10:50:00.000Z' },
      }),
      row(),
      row({
        eventId: 'ev-2',
        course: '4.º A',
        startAt: '2026-10-08T15:00:00.000Z',
        endAt: '2026-10-08T15:45:00.000Z',
        rollCall: { canEdit: false, blockedReason: 'NOT_STARTED', opensAt: '2026-10-08T14:50:00.000Z' },
      }),
    ])

    render(<RollCallTodayList />)

    const now = await screen.findByRole('region', { name: 'Ahora' })
    expect(within(now).getByText('3.º B')).toBeInTheDocument()
    expect(within(now).getByText('Pasá la lista')).toBeInTheDocument()
    expect(within(now).getByRole('link')).toHaveAttribute('href', '/me/roll-call/ev-1/2026-10-08')

    const later = screen.getByRole('region', { name: 'Más tarde' })
    expect(within(later).getByText('4.º A')).toBeInTheDocument()
    expect(within(later).getByText('Abre 11:50')).toBeInTheDocument()

    const done = screen.getByRole('region', { name: 'Terminadas' })
    expect(within(done).getByText('Pasada 08:07')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/student-attendance/my-classes?date=2026-10-08')
  })

  it('dice quién da la clase cuando hay suplencia', async () => {
    apiMock.mockResolvedValue([
      row({ teacher: { id: 'bea', name: 'Beatriz Sosa' }, substitute: { id: 'ana', name: 'Ana Pérez' }, isSubstitution: true }),
      row({ eventId: 'ev-2', course: '4.º A', substitute: { id: 'juan', name: 'Juan Gómez' } }),
    ])

    render(<RollCallTodayList />)

    expect(await screen.findByText('Suplencia: cubrís a Beatriz Sosa')).toBeInTheDocument()
    expect(screen.getByText('La pasa Juan Gómez (suplencia)')).toBeInTheDocument()
  })

  it('muestra el día en palabras y navega por días con la fecha en la URL', async () => {
    render(<RollCallTodayList />)

    expect(await screen.findByText('Jueves 8 de octubre')).toBeInTheDocument()
    expect(screen.getByText('· hoy')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    expect(replaceMock).toHaveBeenCalledWith('/me/roll-call?date=2026-10-09')
  })

  it('otro día: lo pide al servidor y ofrece volver a hoy', async () => {
    searchParams = new URLSearchParams('date=2026-10-07')
    render(<RollCallTodayList />)

    expect(await screen.findByText('Miércoles 7 de octubre')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/student-attendance/my-classes?date=2026-10-07')
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    expect(replaceMock).toHaveBeenCalledWith('/me/roll-call')
  })

  it('en un día no laborable lo avisa una vez', async () => {
    apiMock.mockResolvedValue([row({ nonWorkingDay: 'Feriado' }), row({ eventId: 'ev-2', nonWorkingDay: 'Feriado' })])
    render(<RollCallTodayList />)
    expect(await screen.findByText('Día no laborable: Feriado. No se pasa lista.')).toBeInTheDocument()
  })
})
