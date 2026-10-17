import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('una lista sin pasar abre con todos presentes y se guarda sin tocar nada', async () => {
    apiMock.mockImplementation(async (_path: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? sheet({ rollCall: { status: 'TAKEN' } }) : sheet(),
    )
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)

    fireEvent.click(await screen.findByRole('button', { name: /Guardar lista/ }))

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/student-attendance/sessions/ev-1/2026-10-08', expect.objectContaining({ method: 'PUT' })))
    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1].body).entries).toEqual([{ studentId: 's1', status: 'PRESENT', note: null }])
  })

  it('un solo botón recorre presente, ausente, tarde y presente, también con el teclado', async () => {
    apiMock.mockResolvedValue(sheet())
    const user = userEvent.setup()
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)
    const button = await screen.findByRole('button', { name: /^Presente — Cabrera, Camila/ })
    await user.click(button)
    expect(button).toHaveTextContent('Ausente')
    expect(button).toHaveAccessibleName(/Cambiar a llegada tarde/)
    await user.click(button)
    expect(button).toHaveTextContent('Llegada tarde')
    await user.keyboard('{Enter}')
    expect(button).toHaveTextContent('Presente')
    expect(apiMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('guarda la marca elegida y una nota de varias palabras', async () => {
    apiMock.mockResolvedValue(sheet())
    const user = userEvent.setup()
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)
    const button = await screen.findByRole('button', { name: /^Presente — Cabrera, Camila/ })
    await user.click(button)
    await user.click(button)
    await user.click(screen.getByRole('button', { name: 'Nota para Cabrera, Camila' }))
    await user.type(screen.getByRole('textbox', { name: 'Nota para Cabrera, Camila' }), 'Llegó a las 10:15')
    await user.click(screen.getByRole('button', { name: 'Guardar lista' }))
    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1].body).entries).toEqual([{ studentId: 's1', status: 'LATE', note: 'Llegó a las 10:15' }])
  })

  it('al buscar conserva las marcas de quienes quedan fuera del filtro', async () => {
    const data = sheet()
    data.students.push({ ...data.students[0], studentId: 's2', lastName: 'Díaz', firstName: 'Lucía', documentId: '5.123.456-7' })
    apiMock.mockResolvedValue(data)
    const user = userEvent.setup()
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)
    await user.click(await screen.findByRole('button', { name: /^Presente — Cabrera, Camila/ }))
    const search = screen.getByRole('searchbox', { name: 'Buscar estudiante' })
    await user.type(search, 'diaz')
    expect(screen.queryByText('Cabrera, Camila')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Presente — Díaz, Lucía/ })).toBeInTheDocument()
    await user.clear(search)
    expect(screen.getByRole('button', { name: /^Ausente — Cabrera, Camila/ })).toBeInTheDocument()
    await user.type(search, '5123456')
    expect(screen.queryByText('Cabrera, Camila')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar lista' }))
    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1].body).entries).toEqual([
      { studentId: 's1', status: 'ABSENT', note: null }, { studentId: 's2', status: 'PRESENT', note: null },
    ])
  })

  it('conserva una lista guardada y bloquea la edición durante el guardado', async () => {
    const data = sheet({ rollCall: { status: 'TAKEN' } })
    data.students[0].status = 'ABSENT_JUSTIFIED'
    let finishSave!: (value: SheetResponse) => void
    apiMock.mockImplementation(async (_path: string, init?: { method?: string }) => init?.method === 'PUT'
      ? new Promise<SheetResponse>((resolve) => { finishSave = resolve }) : data)
    const user = userEvent.setup()
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)
    const button = await screen.findByRole('button', { name: /^Ausente justificado — Cabrera, Camila/ })
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    await user.click(button)
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(button).toBeDisabled()
    await user.click(screen.getByLabelText('Opciones de lista'))
    expect(screen.getByRole('button', { name: 'Todos presentes' })).toBeDisabled()
    finishSave({ ...data, students: [{ ...data.students[0], status: 'PRESENT' }] })
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Lista guardada')
  })

  it('copia la hora anterior del mismo grupo y lo guarda como copiada', async () => {
    const previous = {
      available: true,
      reason: null,
      sourceSession: { id: 'ses-prev', subject: 'Historia', startAt: '2026-10-08T12:00:00.000Z', endAt: '2026-10-08T12:45:00.000Z', takenBy: 'Ana Pérez' },
      suggestions: [{ studentId: 's1', status: 'ABSENT' }],
      newStudentIds: [],
    }
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return sheet({ rollCall: { status: 'TAKEN', copyPreviousEnabled: true } })
      if (path.endsWith('/previous')) return previous
      return sheet({ rollCall: { copyPreviousEnabled: true } })
    })
    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)

    fireEvent.click(await screen.findByLabelText('Opciones de lista'))
    fireEvent.click(screen.getByRole('button', { name: /Copiar hora anterior/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar sugerencia' }))
    fireEvent.click(screen.getByRole('button', { name: /Guardar lista/ }))

    await waitFor(() => expect(apiMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(put![1].body)).toMatchObject({
      source: 'COPIED_FROM_PREVIOUS',
      copiedFromSessionId: 'ses-prev',
      entries: [{ studentId: 's1', status: 'ABSENT', note: null }],
    })
  })

  it('al guardar avisa a la franja de arriba', async () => {
    const saved = sheet({ rollCall: { status: 'TAKEN', takenAt: '2026-10-08T13:11:00.000Z', takenBy: 'Juan Gómez' } })
    apiMock.mockImplementation(async (_path: string, init?: { method?: string }) => (init?.method === 'PUT' ? saved : sheet()))
    const listener = vi.fn()
    globalThis.addEventListener(ROLL_CALL_SAVED_EVENT, listener)

    render(<RollCallSheet eventId="ev-1" ymd="2026-10-08" />)
    fireEvent.click(await screen.findByLabelText('Opciones de lista'))
    fireEvent.click(screen.getByRole('button', { name: /Todos presentes/ }))
    fireEvent.click(screen.getByRole('button', { name: /Guardar lista/ }))

    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Pasada 10:11 · Juan Gómez')).toBeInTheDocument()
    globalThis.removeEventListener(ROLL_CALL_SAVED_EVENT, listener)
  })
})
