import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RollCallSheet, { type SheetResponse } from './RollCallSheet'
import { ROLL_CALL_SAVED_EVENT } from '@/lib/rollcall/class-row'

// El router de Next es estable entre renders; uno nuevo en cada render recargaría la planilla sin fin.
const { routerMock, pushMock } = vi.hoisted(() => {
  const push = vi.fn()
  return { pushMock: push, routerMock: { push, replace: vi.fn() } }
})
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
}))

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ me: { id: 'juan' } }),
}))

/** Matemática de 3.º B, jueves 8/10 10:00–10:45 (13:00–13:45 UTC). */
type SheetOverrides = Omit<Partial<SheetResponse>, 'rollCall'> & { rollCall?: Partial<SheetResponse['rollCall']> }

function sheet(over: SheetOverrides = {}): SheetResponse {
  const { rollCall, ...rest } = over
  return {
    eventId: 'ev-1',
    ymd: '2026-10-08',
    title: 'Matemática',
    subject: 'Matemática',
    course: '3.º B',
    orientation: 'Científico',
    startAt: '2026-10-08T13:00:00.000Z',
    endAt: '2026-10-08T13:45:00.000Z',
    teacher: { id: 'ana', name: 'Ana Pérez' },
    substitute: { id: 'juan', name: 'Juan Gómez' },
    students: [
      {
        studentId: 's1',
        firstName: 'Camila',
        lastName: 'Cabrera',
        documentId: null,
        entryId: null,
        status: null,
        note: null,
        markedAt: null,
      },
    ],
    ...rest,
    rollCall: {
      sessionId: null,
      status: 'PENDING',
      takenAt: null,
      takenBy: null,
      notes: null,
      canEdit: true,
      blockedReason: null,
      opensAt: '2026-10-08T12:50:00.000Z',
      editableUntil: '2026-10-10T13:45:00.000Z',
      copyPreviousEnabled: false,
      ...rollCall,
    },
  }
}

describe('<RollCallSheet />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-10-08T13:10:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('dice qué clase es: grupo, asignatura, día, hora y quién la da', async () => {
    apiMock.mockResolvedValue(sheet())
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)

    expect(await screen.findByRole('heading', { name: '3.º B · Científico' })).toBeInTheDocument()
    expect(screen.getByText('Matemática')).toBeInTheDocument()
    expect(screen.getByText('Jueves 8 de octubre · 10:00–10:45')).toBeInTheDocument()
    expect(screen.getByText('Suplencia: cubrís a Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText('Pasá la lista')).toBeInTheDocument()
  })

  it('antes de hora explica cuándo abre y no deja marcar', async () => {
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'))
    apiMock.mockResolvedValue(sheet({ rollCall: { canEdit: false, blockedReason: 'NOT_STARTED' } }))
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)

    expect(await screen.findByText('La lista se abre a las 09:50, 10 minutos antes de la clase.')).toBeInTheDocument()
    expect(screen.getByText('Abre 09:50')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guardar lista/ })).toBeDisabled()
  })

  it('"Mis clases" vuelve al día de la lista', async () => {
    vi.setSystemTime(new Date('2026-10-10T13:10:00.000Z'))
    apiMock.mockResolvedValue(sheet())
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)

    fireEvent.click(await screen.findByRole('button', { name: /Mis clases/ }))
    expect(pushMock).toHaveBeenCalledWith('/me/roll-call?date=2026-10-08')
  })

  it('al guardar avisa a la franja de arriba', async () => {
    const saved = sheet({ rollCall: { status: 'TAKEN', takenAt: '2026-10-08T13:11:00.000Z', takenBy: 'Juan Gómez' } })
    apiMock.mockImplementation(async (_path: string, init?: { method?: string }) => (init?.method === 'PUT' ? saved : sheet()))
    const listener = vi.fn()
    globalThis.addEventListener(ROLL_CALL_SAVED_EVENT, listener)

    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)
    fireEvent.click(await screen.findByRole('button', { name: /Todos presentes/ }))
    fireEvent.click(screen.getByRole('button', { name: /Guardar lista/ }))

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Pasada 10:11 · Juan Gómez')).toBeInTheDocument()
    globalThis.removeEventListener(ROLL_CALL_SAVED_EVENT, listener)
  })
})
