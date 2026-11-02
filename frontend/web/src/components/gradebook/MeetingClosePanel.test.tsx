import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MeetingClosePanel, { closeErrorText, openingMeeting } from './MeetingClosePanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const { authState } = vi.hoisted(() => ({ authState: { me: null as unknown } }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => authState }))

type Meeting = { periodId: string; name: string; kind: string; isMeeting: boolean; status: string; closedAt?: string; closesOn?: string }

const MEETINGS: Meeting[] = [
  { periodId: 'p-1', name: '1.ª Entrega', kind: 'ENTREGA', isMeeting: true, status: 'CLOSED', closedAt: '2026-05-31T15:00:00Z' },
  { periodId: 'p-2', name: '2.ª Entrega', kind: 'ENTREGA', isMeeting: true, status: 'OPEN', closesOn: '2026-08-15' },
  { periodId: 't-1', name: 'Marzo-Abril', kind: 'TRAMO', isMeeting: false, status: 'CLOSED' },
]

const STUDENTS = [
  { studentId: 's1', lastName: 'Díaz', firstName: 'Ana' },
  { studentId: 's2', lastName: 'Sosa', firstName: 'Beto' },
]

function sheet(periodId: string, blockers: unknown[] = [], status = 'OPEN', reopenReason: string | null = null) {
  return {
    period: { id: periodId, name: periodId, judgementLabel: 'Informe de actuación' },
    state: { status, closedAt: null, closedLate: false, reopenReason },
    blockers,
    students: STUDENTS,
  }
}

function review(periodId: string, over: Record<string, unknown> = {}) {
  return {
    gradeBookPeriodId: `gbp-${periodId}`,
    gradeBookId: 'gb-1',
    periodStatus: 'CLOSED',
    period: { id: periodId, name: periodId },
    subject: { name: 'Biología' },
    teacher: { name: 'Jorge' },
    courseName: '8 EBI',
    orientationName: null,
    closedLate: false,
    sections: [],
    overallStatus: 'PENDING',
    pendingAgeDays: 1,
    blockingSections: [],
    canFinalize: true,
    reclosedAfterObservation: false,
    reopenReason: null,
    history: [],
    ...over,
  }
}

function respond({
  meetings = MEETINGS,
  reviews = [] as unknown[],
  sheets = {} as Record<string, unknown>,
  post,
}: {
  meetings?: Meeting[]
  reviews?: unknown[]
  sheets?: Record<string, unknown>
  post?: (path: string) => unknown
} = {}) {
  mockedApi.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return (post ?? (() => ({ coveredPeriodCodes: ['MAY-JUN'] })))(path) as never
    if (path === '/gradebook/gb-1/periods') return { data: meetings } as never
    if (path === '/gradebook/gb-1/endorsements') return { data: reviews } as never
    const id = path.split('/').at(-1)!
    return (sheets[id] ?? sheet(id)) as never
  })
}

const panelOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('li') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  authState.me = null
})

describe('<MeetingClosePanel />', () => {
  it('abre la primera reunión sin cerrar y dice qué falta, con los nombres', async () => {
    respond({
      sheets: {
        'p-2': sheet('p-2', [
          { code: 'MISSING_GRADES', studentIds: ['s1', 's2'] },
          { code: 'MISSING_JUDGEMENT', studentIds: ['s2'] },
          { code: 'MISSING_GROUP_REPORT', studentIds: [] },
        ]),
      },
    })
    const onPickStudent = vi.fn()
    const onOpenGroup = vi.fn()
    render(<MeetingClosePanel gradeBookId="gb-1" canClose onPickStudent={onPickStudent} onOpenGroup={onOpenGroup} />)

    const missing = (await screen.findByText('Falta para cerrar')).closest('div') as HTMLElement
    expect(screen.getByRole('button', { name: /^2\.ª Entrega/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(missing).getByText('R (rendimiento)')).toBeInTheDocument()
    expect(within(missing).getByText('Informe de actuación')).toBeInTheDocument()
    // Los tramos no son reuniones: no aparecen.
    expect(screen.queryByText('Marzo-Abril')).toBeNull()
    // Sin faltantes resueltos no se ofrece cerrar.
    expect(screen.queryByRole('button', { name: /Cerrar 2\.ª Entrega/ })).toBeNull()

    fireEvent.click(within(missing).getAllByRole('button', { name: 'Sosa, Beto' })[0])
    expect(onPickStudent).toHaveBeenCalledWith('s2')
    fireEvent.click(within(missing).getByRole('button', { name: 'Ir al informe del grupo' }))
    expect(onOpenGroup).toHaveBeenCalledWith('p-2')
    fireEvent.click(within(missing).getByRole('button', { name: 'Completarlo en la tabla de todo el grupo' }))
    expect(onOpenGroup).toHaveBeenCalledTimes(2)
  })

  it('muestra cuatro nombres y cuenta el resto', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ studentId: `x${i}`, lastName: `Apellido${i}`, firstName: 'N' }))
    respond({
      sheets: { 'p-2': { ...sheet('p-2', [{ code: 'MISSING_CONDUCT', studentIds: many.map((s) => s.studentId) }]), students: many } },
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose onPickStudent={vi.fn()} />)
    const missing = (await screen.findByText('Falta para cerrar')).closest('div') as HTMLElement
    expect(within(missing).getAllByRole('button', { name: /Apellido/ })).toHaveLength(4)
    expect(within(missing).getByText('y 2 más')).toBeInTheDocument()
  })

  it('con todo cargado, cierra con confirmación y dice qué sigue', async () => {
    respond()
    const onChanged = vi.fn()
    render(<MeetingClosePanel gradeBookId="gb-1" canClose onChanged={onChanged} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar 2.ª Entrega' }))
    expect(screen.getByText(/Se cierran también sus tramos/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cerrar 2.ª Entrega' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-1/periods/p-2/close', { method: 'POST' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Se cerró 2.ª Entrega y sus tramos. Ahora la revisa Dirección.')
    expect(onChanged).toHaveBeenCalled()
    // Vuelve a pedir el estado de las reuniones.
    await waitFor(() => expect(mockedApi.mock.calls.filter(([path]) => path === '/gradebook/gb-1/periods')).toHaveLength(2))
  })

  it('si al cerrar falta algo (otra pestaña, otra persona), lo dice entero', async () => {
    respond({
      post: () => {
        throw Object.assign(new Error('No se puede cerrar'), {
          data: { message: 'No se puede cerrar', detail: { blockers: [{ code: 'MISSING_GRADES', studentIds: ['s1', 's2'] }] } },
        })
      },
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar 2.ª Entrega' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cerrar 2.ª Entrega' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se puede cerrar todavía: 2 sin R (rendimiento).')
  })

  it('cerrada y observada: muestra la observación y qué sigue', async () => {
    respond({
      meetings: [MEETINGS[0]],
      reviews: [
        review('p-1', {
          blockingSections: ['JUDGEMENTS'],
          canFinalize: false,
          sections: [{ section: 'JUDGEMENTS', status: 'OBSERVED', occurredAt: '2026-06-02T12:00:00Z', observations: 'Falta el juicio de Ana.' }],
        }),
      ],
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose />)

    const item = await waitFor(() => panelOf('1.ª Entrega'))
    expect(await within(item).findByText('Falta el juicio de Ana.')).toBeInTheDocument()
    expect(within(item).getByText('Observación sobre juicios')).toBeInTheDocument()
    expect(within(item).getByText(/Te hicieron observaciones/)).toBeInTheDocument()
    expect(within(item).getByText(/Cerrada el 31\/05\/2026/)).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: /Cerrar/ })).toBeNull()
  })

  it('reabierta: el docente lee el motivo y vuelve a ver qué falta', async () => {
    respond({
      meetings: [{ ...MEETINGS[0], status: 'REOPENED' }],
      reviews: [review('p-1', { periodStatus: 'REOPENED', reopenReason: 'Corregir el juicio de Ana' })],
      sheets: { 'p-1': sheet('p-1', [{ code: 'MISSING_JUDGEMENT', studentIds: ['s1'] }], 'REOPENED', 'Corregir el juicio de Ana') },
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose />)
    expect(await screen.findByText(/Reabierta para corregir: Corregir el juicio de Ana/)).toBeInTheDocument()
    expect(await screen.findByText('Falta para cerrar')).toBeInTheDocument()
  })

  it('visada: lo dice con la fecha', async () => {
    respond({
      meetings: [MEETINGS[0]],
      reviews: [
        review('p-1', {
          overallStatus: 'ENDORSED',
          sections: [{ section: 'ALL', status: 'ENDORSED', occurredAt: '2026-06-10T12:00:00Z', observations: null }],
        }),
      ],
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose />)
    expect(await screen.findByText('Visada el 10/06/2026')).toBeInTheDocument()
  })

  it('administración reabre una reunión cerrada con motivo', async () => {
    authState.me = { permissions: [{ id: 'gradebook.manage', scope: 'all' }] }
    respond({ meetings: [MEETINGS[0]] })
    const onChanged = vi.fn()
    render(<MeetingClosePanel gradeBookId="gb-1" canClose={false} onChanged={onChanged} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir para que corrija' }))
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

  it('quien sólo lee la libreta ve lo mismo, sin botones de cerrar ni reabrir', async () => {
    authState.me = { permissions: [{ id: 'gradebook.read', scope: 'all' }] }
    respond()
    render(<MeetingClosePanel gradeBookId="gb-1" canClose={false} />)
    expect(await screen.findByText('Todo cargado: falta cerrarla.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cerrar 2\.ª Entrega/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^1\.ª Entrega/ }))
    expect(screen.queryByRole('button', { name: /Reabrir/ })).toBeNull()
  })
})

describe('auxiliares del panel', () => {
  it('abre la primera sin cerrar; si están todas cerradas, la última', () => {
    expect(openingMeeting([{ status: 'CLOSED' }, { status: 'REOPENED' }, { status: 'OPEN' }])).toEqual({ status: 'REOPENED' })
    expect(openingMeeting([{ status: 'CLOSED', id: 'a' }, { status: 'CLOSED', id: 'b' }] as never)).toEqual({ status: 'CLOSED', id: 'b' })
    expect(openingMeeting([])).toBeNull()
  })

  it('el error de cierre lista todos los faltantes', () => {
    const err = { data: { detail: { blockers: [{ code: 'MISSING_CONDUCT', studentIds: ['a'] }, { code: 'MISSING_GROUP_REPORT', studentIds: [] }] } } }
    expect(closeErrorText(err)).toBe('No se puede cerrar todavía: 1 sin C (conducta) · falta el informe del grupo.')
  })
})
