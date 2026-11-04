import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MeetingClosePanel from './MeetingClosePanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const { authState } = vi.hoisted(() => ({ authState: { me: null as unknown } }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => authState }))

type Meeting = Record<string, unknown> & { periodId: string; name: string; status: string }

function meeting(over: Partial<Meeting> & { periodId: string; name: string }): Meeting {
  return {
    kind: 'ENTREGA',
    sortOrder: 30,
    reportCard: true,
    judgementLabel: 'Informe de actuación',
    closesOn: null,
    status: 'OPEN',
    closedAt: null,
    closedLate: false,
    reopenReason: null,
    missing: [],
    review: null,
    ...over,
  }
}

const MEETINGS: Meeting[] = [
  meeting({ periodId: 'p-1', name: '1.ª Entrega', status: 'CLOSED', closedAt: '2026-05-31T15:00:00Z', missing: null }),
  meeting({ periodId: 'p-2', name: '2.ª Entrega', closesOn: '2026-08-15' }),
]

const STUDENTS = [
  { studentId: 's1', lastName: 'Díaz', firstName: 'Ana' },
  { studentId: 's2', lastName: 'Sosa', firstName: 'Beto' },
]

function review(over: Record<string, unknown> = {}) {
  return { sections: [], overallStatus: 'PENDING', blockingSections: [], reclosedAfterObservation: false, ...over }
}

function respond({
  meetings = MEETINGS,
  students = STUDENTS,
  post,
}: {
  meetings?: Meeting[]
  students?: unknown[]
  post?: (path: string) => unknown
} = {}) {
  mockedApi.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return (post ?? (() => ({ coveredPeriodCodes: ['MAY-JUN'] })))(path) as never
    if (path === '/gradebook/gb-1/meetings') return { students, data: meetings } as never
    throw new Error(`sin respuesta para ${path}`)
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
      meetings: [
        MEETINGS[0],
        meeting({
          periodId: 'p-2',
          name: '2.ª Entrega',
          missing: [
            { code: 'MISSING_GRADES', studentIds: ['s1', 's2'] },
            { code: 'MISSING_JUDGEMENT', studentIds: ['s2'] },
            { code: 'MISSING_GROUP_REPORT', studentIds: [] },
          ],
        }),
      ],
    })
    const onPickStudent = vi.fn()
    const onOpenGroup = vi.fn()
    render(<MeetingClosePanel gradeBookId="gb-1" canClose onPickStudent={onPickStudent} onOpenGroup={onOpenGroup} />)

    const missing = (await screen.findByText('Falta para cerrar')).closest('div') as HTMLElement
    expect(screen.getByRole('button', { name: /^2\.ª Entrega/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(missing).getByText('R (rendimiento)')).toBeInTheDocument()
    expect(within(missing).getByText('Informe de actuación')).toBeInTheDocument()
    // Un solo pedido: el panel ya no pide la planilla de cada reunión.
    expect(mockedApi).toHaveBeenCalledTimes(1)
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
      students: many,
      meetings: [meeting({ periodId: 'p-2', name: '2.ª Entrega', missing: [{ code: 'MISSING_CONDUCT', studentIds: many.map((s) => s.studentId) }] })],
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
    await waitFor(() => expect(mockedApi.mock.calls.filter(([path]) => path === '/gradebook/gb-1/meetings')).toHaveLength(2))
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
      meetings: [
        {
          ...MEETINGS[0],
          review: review({
            blockingSections: ['JUDGEMENTS'],
            sections: [{ section: 'JUDGEMENTS', status: 'OBSERVED', occurredAt: '2026-06-02T12:00:00Z', observations: 'Falta el juicio de Ana.' }],
          }),
        },
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
      meetings: [
        {
          ...MEETINGS[0],
          status: 'REOPENED',
          reopenReason: 'Corregir el juicio de Ana',
          missing: [{ code: 'MISSING_JUDGEMENT', studentIds: ['s1'] }],
          review: review(),
        },
      ],
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose />)
    expect(await screen.findByText(/Reabierta para corregir: Corregir el juicio de Ana/)).toBeInTheDocument()
    expect(await screen.findByText('Falta para cerrar')).toBeInTheDocument()
  })

  it('visada: lo dice con la fecha', async () => {
    respond({
      meetings: [
        {
          ...MEETINGS[0],
          review: review({
            overallStatus: 'ENDORSED',
            sections: [{ section: 'ALL', status: 'ENDORSED', occurredAt: '2026-06-10T12:00:00Z', observations: null }],
          }),
        },
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

describe('lo nuevo del panel', () => {
  it('muestra la etapa de todas las reuniones, no sólo la elegida', async () => {
    respond({
      meetings: [
        meeting({ periodId: 'p-2', name: '2.ª Entrega' }),
        meeting({ periodId: 'p-3', name: '3.ª Entrega', missing: [{ code: 'MISSING_GRADES', studentIds: ['s1'] }] }),
      ],
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose />)
    expect(await within(await waitFor(() => panelOf('2.ª Entrega'))).findByText('Lista para cerrar')).toBeInTheDocument()
    expect(within(panelOf('3.ª Entrega')).getByText('Abierta')).toBeInTheDocument()
  })

  it('abre la reunión del aviso (`?periodId=`)', async () => {
    respond({ meetings: [meeting({ periodId: 'p-2', name: '2.ª Entrega' }), meeting({ periodId: 'p-3', name: '3.ª Entrega' })] })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose initialPeriodId="p-3" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^3\.ª Entrega/ })).toHaveAttribute('aria-expanded', 'true'))
  })

  it('las notas de evaluaciones que faltan llevan a Calificaciones, a la carta de cada alumno', async () => {
    respond({
      meetings: [
        meeting({
          periodId: 'p-2',
          name: '2.ª Entrega',
          missing: [
            { code: 'MISSING_ASSESSMENT_GRADES', studentIds: ['s2'], slots: 2 },
            { code: 'NO_ASSESSMENTS', studentIds: [] },
          ],
        }),
      ],
    })
    render(<MeetingClosePanel gradeBookId="gb-1" canClose onOpenGroup={vi.fn()} />)
    const missing = (await screen.findByText('Falta para cerrar')).closest('div') as HTMLElement
    expect(within(missing).getByText(/2 notas; a quien no rindió, marcale «No rindió»/)).toBeInTheDocument()
    expect(within(missing).getByRole('link', { name: 'Sosa, Beto' })).toHaveAttribute('href', '/libreta/gb-1/evaluaciones?alumno=s2')
    expect(within(missing).getByRole('link', { name: 'Ir a Calificaciones' })).toHaveAttribute('href', '/libreta/gb-1/evaluaciones')
    // Todo se completa en Calificaciones: no ofrece la tabla del cierre.
    expect(within(missing).queryByRole('button', { name: 'Completarlo en la tabla de todo el grupo' })).toBeNull()
  })
})
