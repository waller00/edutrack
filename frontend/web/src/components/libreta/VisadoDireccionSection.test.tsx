import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VisadoDireccionSection from './VisadoDireccionSection'
import ObservacionesDireccion from './ObservacionesDireccion'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/contexts/LibretaContext', () => ({
  useLibreta: () => ({
    gradeBookId: 'gb-1',
    detail: { status: 'ACTIVE', teacher: { id: 't-1', name: 'Ana Benítez', username: null } },
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

function respond(rows = [endorsementRow()]) {
  mockedApi.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/messages/conversations' && init?.method === 'POST') return { data: { id: 'conv-1' } } as never
    if (init?.method === 'POST') return { ok: true } as never
    if (path === '/gradebook/gb-1/endorsements') return { data: rows } as never
    if (path === '/gradebook/gb-1/periods') {
      return {
        data: [
          { periodId: 'p-1', name: '1.ª Entrega', status: 'CLOSED', groupReport: null, groupReportUpdatedAt: null, requiresGroupReport: true },
        ],
      } as never
    }
    if (path === '/gradebook/gb-1/planning') return { data: { formative: 'Unidad 1: célula.', replanning: null, updatedAt: '2026-03-10' } } as never
    if (path === '/gradebook/gb-1/development') {
      return {
        data: [{ id: 'd1', date: '2026-04-02', description: 'Mitosis' }],
        totals: { hoursTaught: 12, hoursNotTaught: 2 },
      } as never
    }
    if (path.startsWith('/admin/gradebook/endorsements/')) return { history: [] } as never
    return { data: [] } as never
  })
}

describe('<VisadoDireccionSection />', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    openDrawer.mockReset()
  })

  it('reúne lo que Dirección revisa: calificaciones, seguimiento e informe del grupo', async () => {
    respond()
    render(<VisadoDireccionSection />)

    expect(await screen.findByText('1.ª Entrega', { selector: 'span' })).toBeInTheDocument()
    for (const label of ['Calificaciones', 'Seguimiento', 'Informe del grupo']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(await screen.findByText('Unidad 1: célula.')).toBeInTheDocument()
    expect(screen.getByText(/1 clase registrada · 12 h dictadas · 2 h sin dictar/)).toBeInTheDocument()
    expect(screen.getByText('▲ Falta el informe del grupo.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mensajes al docente' })).not.toBeInTheDocument()
  })

  it('"Escribirle al docente" abre la mensajería en la conversación con el docente', async () => {
    respond()
    render(<VisadoDireccionSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Escribirle al docente' }))

    await waitFor(() => expect(openDrawer).toHaveBeenCalledWith('conv-1'))
    const post = mockedApi.mock.calls.find(([path]) => path === '/messages/conversations')
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ userId: 't-1' })
  })

  it('visa el período cerrado', async () => {
    respond()
    render(<VisadoDireccionSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Visar 1.ª Entrega' }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([path]) => path === '/admin/gradebook/endorsements')
      expect(post?.[0]).toBe('/admin/gradebook/endorsements')
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
        gradeBookPeriodId: 'gbp-1',
        section: 'ALL',
        status: 'ENDORSED',
      })
    })
  })

  it('con una sección observada sin corregir no deja visar', async () => {
    respond([endorsementRow({ canFinalize: false, blockingSections: ['GROUP_REPORT'] })])
    render(<VisadoDireccionSection />)

    expect(await screen.findByRole('button', { name: 'Visar 1.ª Entrega' })).toBeDisabled()
  })

  it('sin reuniones cerradas lo explica y deja escribirle al docente', async () => {
    respond([endorsementRow({ periodStatus: 'OPEN' })])
    render(<VisadoDireccionSection />)

    expect(await screen.findByText(/todavía no cerró ninguna reunión/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Escribirle al docente' })).toBeInTheDocument()
  })
})

describe('<ObservacionesDireccion />', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('le muestra al docente lo que le observaron y si está reabierto para corregir', async () => {
    const observed = SECTIONS.map((s) =>
      s.section === 'GROUP_REPORT' ? { ...s, status: 'OBSERVED', observations: 'Falta el informe del grupo.' } : s,
    )
    mockedApi.mockResolvedValue({
      data: [endorsementRow({ sections: observed, overallStatus: 'OBSERVED', periodStatus: 'REOPENED', reopenReason: 'Completar' })],
    } as never)
    render(<ObservacionesDireccion gradeBookId="gb-1" />)

    const item = await screen.findByText(/Te observaron informe del grupo · 1.ª Entrega/)
    const card = item.closest('li') as HTMLElement
    expect(within(card).getByText('Falta el informe del grupo.')).toBeInTheDocument()
    expect(within(card).getByText(/reabierto para que lo corrijas: Completar/)).toBeInTheDocument()
  })

  it('sin observaciones ni visados no ocupa lugar', async () => {
    mockedApi.mockResolvedValue({ data: [endorsementRow()] } as never)
    const { container } = render(<ObservacionesDireccion gradeBookId="gb-1" />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
