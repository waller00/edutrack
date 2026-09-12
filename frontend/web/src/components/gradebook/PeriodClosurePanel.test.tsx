import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PeriodClosurePanel from './PeriodClosurePanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const ROW = {
  studentId: 's1',
  lastName: 'Benítez',
  firstName: 'Ana',
  assessmentCount: 3,
  valueHundredths: 700,
  conceptualJudgement: 'Progresa bien.',
  descriptor: {
    levelId: 'l-alto',
    label: 'Logrado',
    descriptor: 'Alcanza los aprendizajes.',
    colorToken: 'green',
    iconToken: 'check',
    isAlert: false,
  },
}

const SHEET = {
  period: {
    id: 'p-1',
    name: 'Mayo',
    closesOn: '2026-06-08',
    requiresGeneralGrade: true,
    requiresConceptualJudgement: true,
  },
  state: { status: 'OPEN' as const, closedAt: null, closedLate: false, reopenReason: null },
  canEdit: true,
  blockers: [],
  students: [ROW],
}

beforeEach(() => {
  mockedApi.mockReset()
  mockedApi.mockResolvedValue(SHEET as any)
})

describe('PeriodClosurePanel', () => {
  it('precarga la calificación y el juicio guardados', async () => {
    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    await waitFor(() =>
      expect((screen.getByLabelText('Calificación del período de Benítez, Ana') as HTMLInputElement).value).toBe('7'),
    )
    expect((screen.getByLabelText('Juicio conceptual de Benítez, Ana') as HTMLTextAreaElement).value).toBe(
      'Progresa bien.',
    )
  })

  it('la libreta del docente NO promedia', async () => {
    // El liceo fue explícito: ninguna libreta del docente hace promedio automático. La
    // calificación general del período la decide él. El promedio vive en la planilla de reunión.
    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    await screen.findByText('Benítez, Ana')

    expect(screen.queryByText(/promedio/i)).not.toBeInTheDocument()
    expect(screen.queryByTitle('Indicador automático / promedio orientativo')).not.toBeInTheDocument()
  })

  it('sí muestra cuántas notas cargó, que no es un promedio', async () => {
    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    expect(await screen.findByText('Notas cargadas')).toBeInTheDocument()
  })

  it('el descriptor se muestra con texto además del color (RNF 7.2)', async () => {
    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    const badge = await screen.findByTitle('Alcanza los aprendizajes.')
    expect(badge).toHaveTextContent('Logrado')
  })

  it('con bloqueos no deja cerrar y dice qué falta', async () => {
    mockedApi.mockResolvedValue({
      ...SHEET,
      blockers: [{ code: 'MISSING_JUDGEMENT', studentIds: ['s1'] }],
    } as any)

    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)

    expect(await screen.findByText(/1 sin juicio conceptual/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cerrar período/ })).toBeDisabled()
  })

  it('cierra el período cuando no hay bloqueos', async () => {
    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    const close = await screen.findByRole('button', { name: /Cerrar período/ })

    mockedApi.mockResolvedValueOnce({ closedLate: false } as any)
    fireEvent.click(close)

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'POST')
      expect(String(post?.[0])).toContain('/periods/p-1/close')
    })
  })

  it('avisa cuando el cierre quedó fuera de plazo', async () => {
    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    const close = await screen.findByRole('button', { name: /Cerrar período/ })

    mockedApi.mockResolvedValueOnce({ closedLate: true } as any)
    fireEvent.click(close)

    expect(await screen.findByRole('status')).toHaveTextContent('fuera de plazo')
  })

  it('un período cerrado es de sólo lectura y no ofrece acciones', async () => {
    mockedApi.mockResolvedValue({
      ...SHEET,
      state: { status: 'CLOSED', closedAt: '2026-06-01T12:00:00Z', closedLate: false, reopenReason: null },
      canEdit: false,
    } as any)

    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)

    await waitFor(() =>
      expect(screen.getByLabelText('Calificación del período de Benítez, Ana')).toBeDisabled(),
    )
    expect(screen.queryByRole('button', { name: /Cerrar período/ })).not.toBeInTheDocument()
  })

  it('un período reabierto muestra el motivo', async () => {
    mockedApi.mockResolvedValue({
      ...SHEET,
      state: { status: 'REOPENED', closedAt: '2026-06-01T12:00:00Z', closedLate: false, reopenReason: 'error de carga' },
    } as any)

    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    expect(await screen.findByText(/Motivo: error de carga/)).toBeInTheDocument()
  })

  it('guardar manda calificación y juicio de todo el grupo', async () => {
    render(<PeriodClosurePanel gradeBookId="gb-1" periodId="p-1" decimals={0} />)
    await waitFor(() => expect(screen.getByLabelText('Calificación del período de Benítez, Ana')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Calificación del período de Benítez, Ana'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const put = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'PUT')
      expect(JSON.parse((put?.[1] as any).body).entries).toEqual([
        { studentId: 's1', valueHundredths: 900, conceptualJudgement: 'Progresa bien.' },
      ])
    })
  })
})
