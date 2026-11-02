import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VisadoDireccionSection, { openingMeeting, reviewableMeetings } from './VisadoDireccionSection'
import type { DecisionRow } from './VisadoDecision'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
const { search } = vi.hoisted(() => ({ search: { params: new URLSearchParams() } }))
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params }))
vi.mock('@/contexts/LibretaContext', () => ({
  useLibreta: () => ({
    gradeBookId: 'gb-1',
    detail: {
      status: 'ACTIVE',
      teacher: { id: 't-1', name: 'Ana Benítez', username: null },
      schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
    },
  }),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({
    me: {
      permissions: [
        { id: 'gradebook.read', scope: 'all' },
        { id: 'gradebook.review', scope: 'all' },
        { id: 'gradebook.endorse', scope: 'all' },
      ],
    },
  }),
}))
const { openDrawer } = vi.hoisted(() => ({ openDrawer: vi.fn() }))
vi.mock('@/components/messages/MessagesProvider', () => ({
  useOptionalMessages: () => ({ enabled: true, openDrawer }),
}))
const mockedApi = vi.mocked(api)

const SECTIONS = ['GRADES', 'CLOSURE', 'JUDGEMENTS', 'PLANNING', 'GROUP_REPORT', 'ALL'].map((section) => ({
  section,
  status: 'PENDING',
  occurredAt: null,
  observations: null,
}))

function endorsementRow(over: Record<string, unknown> = {}) {
  return {
    gradeBookPeriodId: 'gbp-1',
    gradeBookId: 'gb-1',
    periodStatus: 'CLOSED',
    period: { id: 'p-1', name: '1.ª Entrega' },
    subject: { name: 'Biología' },
    teacher: { name: 'Ana Benítez' },
    courseName: '8 EBI',
    orientationName: null,
    closedLate: false,
    sections: SECTIONS,
    overallStatus: 'PENDING',
    pendingAgeDays: 2,
    blockingSections: [],
    canFinalize: true,
    reopenReason: null,
    history: [],
    ...over,
  }
}

const SECOND = endorsementRow({ gradeBookPeriodId: 'gbp-2', period: { id: 'p-2', name: '2.ª Entrega' } })

const ENTREGA = {
  code: 'ENTREGA_1',
  kind: 'ENTREGA' as const,
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
  judgementLabel: 'Informe de actuación',
  startsOn: '2026-03-01',
  endsOn: '2026-05-31',
}

/** La bandeja de Control: lo pendiente de la reunión. */
const QUEUE = [
  endorsementRow({ gradeBookId: 'gb-1' }),
  endorsementRow({ gradeBookId: 'gb-obs', subject: { name: 'Física' }, blockingSections: ['GRADES'], canFinalize: false }),
  endorsementRow({ gradeBookId: 'gb-2', subject: { name: 'Historia' }, courseName: '1.º' }),
]

function respond(rows = [endorsementRow()], queue: unknown[] = QUEUE) {
  mockedApi.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/messages/conversations' && init?.method === 'POST') return { data: { id: 'conv-1' } } as never
    if (init?.method === 'POST') return { ok: true } as never
    if (path === '/gradebook/gb-1/endorsements') return { data: rows } as never
    if (path === '/gradebook/gb-1/options') return { periods: [], periodScale: null, conduct: [] } as never
    const period = /^\/gradebook\/gb-1\/periods\/(p-\d)$/.exec(path)
    if (period) {
      return {
        period: { ...ENTREGA, id: period[1], name: period[1] },
        state: { status: 'CLOSED' },
        // Aunque se pudiera editar, en la revisión no se edita.
        canEdit: true,
        students: [
          {
            studentId: 's1',
            lastName: 'Díaz',
            firstName: 'Ana',
            assessmentCount: 3,
            valueHundredths: null,
            meetingValueHundredths: 800,
            conceptualJudgement: `Juicio de ${period[1]}.`,
            conductValueHundredths: null,
          },
        ],
        groupReport: { body: 'Buen grupo.', updatedAt: null, required: true },
      } as never
    }
    if (path === '/gradebook/gb-1/planning') return { data: { formative: 'Unidad 1: célula.', replanning: null, updatedAt: '2026-03-10' } } as never
    if (path === '/gradebook/gb-1/development') {
      return {
        data: [{ id: 'd1', date: '2026-04-02', description: 'Mitosis' }],
        totals: { hoursTaught: 12, hoursNotTaught: 2 },
      } as never
    }
    if (path.startsWith('/admin/gradebook/endorsements?')) return { data: queue } as never
    return { data: [] } as never
  })
}

const calledWith = (prefix: string) => mockedApi.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(prefix))

describe('<VisadoDireccionSection />', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    openDrawer.mockReset()
    search.params = new URLSearchParams()
  })

  it('primero muestra lo que cerró el docente, de sólo lectura, y después la decisión', async () => {
    respond()
    render(<VisadoDireccionSection />)

    const review = await screen.findByRole('heading', { name: '1. Lo que cerró el docente · 1.ª Entrega' })
    expect(await screen.findByText('Juicio de p-1.')).toBeInTheDocument()
    expect(screen.getByText('Buen grupo.')).toBeInTheDocument()
    expect(screen.queryByLabelText('R (rendimiento) de Díaz, Ana')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
    expect(await screen.findByText('Unidad 1: célula.')).toBeInTheDocument()
    expect(screen.getByText(/1 clase registrada · 12 h dictadas · 2 h sin dictar/)).toBeInTheDocument()

    const decision = screen.getByRole('heading', { name: '2. Tu decisión' })
    expect(review.compareDocumentPosition(decision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('arriba, las mismas etapas que ve el docente, con las palabras de quien revisa', async () => {
    respond([endorsementRow({ blockingSections: ['GRADES'], canFinalize: false })])
    render(<VisadoDireccionSection />)

    const steps = await screen.findByRole('list', { name: 'Etapas de la reunión' })
    expect(within(steps).getByText('Revisión').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Observada: espera al docente')).toBeInTheDocument()
  })

  it('abre en la reunión que se eligió en Control', async () => {
    search.params = new URLSearchParams({ reunion: 'p-2' })
    respond([endorsementRow(), SECOND])
    render(<VisadoDireccionSection />)

    expect(await screen.findByRole('heading', { name: '1. Lo que cerró el docente · 2.ª Entrega' })).toBeInTheDocument()
    expect(await screen.findByText('Juicio de p-2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2\.ª Entrega/, pressed: true })).toBeInTheDocument()
  })

  it('se cambia de reunión desde los botones de arriba', async () => {
    respond([endorsementRow(), SECOND])
    render(<VisadoDireccionSection />)

    fireEvent.click(await screen.findByRole('button', { name: /2\.ª Entrega/ }))

    expect(await screen.findByText('Juicio de p-2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Visar 2.ª Entrega' })).toBeInTheDocument()
  })

  it('visa y ofrece seguir con la próxima libreta que espera revisión', async () => {
    respond()
    render(<VisadoDireccionSection />)

    // Física está observada (espera al docente): se saltea.
    const next = await screen.findByRole('link', { name: /Siguiente para revisar: Historia \(1\.º\)/ })
    expect(next).toHaveAttribute('href', '/libreta/gb-2/visado?reunion=p-1')
    expect(calledWith('/admin/gradebook/endorsements?')).toEqual([
      '/admin/gradebook/endorsements?pending=true&periodId=p-1&schoolYearId=sy-1',
    ])

    fireEvent.click(await screen.findByRole('button', { name: 'Visar 1.ª Entrega' }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([path, init]) => path === '/admin/gradebook/endorsements' && init?.method === 'POST')
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        gradeBookPeriodId: 'gbp-1',
        section: 'ALL',
        status: 'ENDORSED',
      })
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Se visó 1.ª Entrega')
    // La bandeja se vuelve a pedir después de decidir.
    await waitFor(() => expect(calledWith('/admin/gradebook/endorsements?')).toHaveLength(2))
  })

  it('con el grupo filtrado en Control, "Siguiente" recorre la bandeja de ese grupo', async () => {
    search.params = new URLSearchParams({ reunion: 'p-1', courseOfferingId: 'off-1', courseOrientationId: 'co-1' })
    respond()
    render(<VisadoDireccionSection />)

    expect(await screen.findByRole('link', { name: /Siguiente para revisar/ })).toHaveAttribute(
      'href',
      '/libreta/gb-2/visado?reunion=p-1&courseOfferingId=off-1&courseOrientationId=co-1',
    )
    expect(calledWith('/admin/gradebook/endorsements?')).toEqual([
      '/admin/gradebook/endorsements?pending=true&periodId=p-1&courseOfferingId=off-1&courseOrientationId=co-1&schoolYearId=sy-1',
    ])
  })

  it('si no queda otra para revisar, lo dice', async () => {
    respond([endorsementRow()], [endorsementRow()])
    render(<VisadoDireccionSection />)

    expect(await screen.findByText('No quedan libretas para revisar en esta reunión.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Volver a Control y visado/ })).toHaveAttribute('href', '/libreta/control?paso=visado')
  })

  it('"Escribirle al docente" abre la mensajería en la conversación con el docente', async () => {
    respond()
    render(<VisadoDireccionSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Escribirle al docente' }))

    await waitFor(() => expect(openDrawer).toHaveBeenCalledWith('conv-1'))
    const post = mockedApi.mock.calls.find(([path]) => path === '/messages/conversations')
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ userId: 't-1' })
  })

  it('sin reuniones cerradas lo explica y deja escribirle al docente', async () => {
    respond([endorsementRow({ periodStatus: 'OPEN' })])
    render(<VisadoDireccionSection />)

    expect(await screen.findByText(/todavía no cerró ninguna reunión/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Escribirle al docente' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '2. Tu decisión' })).toBeNull()
  })
})

describe('reunión con la que abre', () => {
  const rows = (...over: Record<string, unknown>[]) => over.map((o, i) => endorsementRow({ period: { id: `p-${i + 1}`, name: `${i + 1}.ª` }, ...o })) as unknown as DecisionRow[]

  it('se revisan las cerradas y las reabiertas con historia', () => {
    const list = rows({}, { periodStatus: 'OPEN' }, { periodStatus: 'REOPENED', history: [{ section: 'GRADES' }] })
    expect(reviewableMeetings(list).map((r) => r.period.id)).toEqual(['p-1', 'p-3'])
  })

  it('la pedida; si no, la primera sin visar; si están todas visadas, la última', () => {
    const list = rows({ overallStatus: 'ENDORSED' }, {}, { overallStatus: 'ENDORSED' })
    expect(openingMeeting(list, 'p-3')?.period.id).toBe('p-3')
    expect(openingMeeting(list, null)?.period.id).toBe('p-2')
    expect(openingMeeting(rows({ overallStatus: 'ENDORSED' }, { overallStatus: 'ENDORSED' }), 'otra')?.period.id).toBe('p-2')
    expect(openingMeeting([], null)).toBeNull()
  })
})
