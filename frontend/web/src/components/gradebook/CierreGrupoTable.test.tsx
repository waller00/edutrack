import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CierreGrupoTable, { currentPeriodId, rowPatch } from './CierreGrupoTable'

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

const ENTREGA = {
  id: 'p-e1',
  code: 'ENTREGA_1',
  name: '1.ª Entrega',
  kind: 'ENTREGA' as const,
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
  judgementLabel: 'Informe de actuación',
  startsOn: '2026-03-01',
  endsOn: '2026-05-31',
}

const ROWS = [
  { studentId: 's1', lastName: 'Benítez', firstName: 'Ana', assessmentCount: 3, valueHundredths: 800, meetingValueHundredths: null, conceptualJudgement: 'Bien.', conductValueHundredths: null },
  { studentId: 's2', lastName: 'Cabrera', firstName: 'Luis', assessmentCount: 1, valueHundredths: null, meetingValueHundredths: null, conceptualJudgement: null, conductValueHundredths: null },
]

function respond(canEdit = true) {
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return { ok: true }
    if (String(path).endsWith('/options')) {
      return {
        periods: [ENTREGA, { ...ENTREGA, id: 'p-e2', code: 'ENTREGA_2', name: '2.ª Entrega', startsOn: '2026-06-01', endsOn: '2026-08-31' }],
        periodScale: { minValueHundredths: 100, maxValueHundredths: 1200 },
        conduct: [
          { valueHundredths: 300, label: 'Buena' },
          { valueHundredths: 400, label: 'Muy buena' },
        ],
      }
    }
    return { period: ENTREGA, state: { status: 'OPEN' }, canEdit, students: ROWS }
  })
}

describe('<CierreGrupoTable />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-10T15:00:00.000Z'))
  })

  it('carga C, R, informe y conducta de todo el grupo y guarda sólo lo que cambió', async () => {
    respond()
    const user = userEvent.setup()
    render(<CierreGrupoTable gradeBookId="gb-1" />)

    await waitFor(() => expect(screen.getByLabelText('C de Cabrera, Luis')).toBeInTheDocument())
    expect(screen.getByLabelText('C de Benítez, Ana')).toHaveValue('8')

    await user.selectOptions(screen.getByLabelText('C de Cabrera, Luis'), '11')
    await user.selectOptions(screen.getByLabelText('Conducta de Cabrera, Luis'), 'Muy buena')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const put = apiMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
      expect(put?.[0]).toBe('/gradebook/gb-1/periods/p-e1/grades')
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
        entries: [{ studentId: 's2', valueHundredths: 1100, conductValueHundredths: 400 }],
      })
    })
  })

  it('pide confirmar antes de cambiar de período con cambios sin guardar', async () => {
    respond()
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<CierreGrupoTable gradeBookId="gb-1" />)
    await waitFor(() => expect(screen.getByLabelText('C de Cabrera, Luis')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('C de Cabrera, Luis'), '7')
    await user.selectOptions(screen.getByLabelText('Período'), '2.ª Entrega')

    expect(confirm).toHaveBeenCalled()
    expect(screen.getByLabelText('Período')).toHaveValue('p-e1')
    confirm.mockRestore()
  })

  it('sin permiso se lee, no se edita', async () => {
    respond(false)
    render(<CierreGrupoTable gradeBookId="gb-1" />)
    await waitFor(() => expect(screen.getByText('Bien.')).toBeInTheDocument())
    expect(screen.queryByLabelText('C de Benítez, Ana')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
  })
})

describe('currentPeriodId', () => {
  const periods = [
    { id: 'a', code: 'A', name: 'A', startsOn: '2026-03-01', endsOn: '2026-05-31' },
    { id: 'b', code: 'B', name: 'B', startsOn: '2026-06-01', endsOn: '2026-08-31' },
  ]

  it('elige el período que contiene hoy, o el último que ya empezó', () => {
    expect(currentPeriodId(periods, '2026-07-01')).toBe('b')
    expect(currentPeriodId(periods.map((p) => ({ ...p, endsOn: '2026-03-15' })), '2026-07-01')).toBe('b')
    expect(currentPeriodId(periods, '2026-01-01')).toBe('a')
  })
})

describe('rowPatch', () => {
  it('sin cambios no manda nada', () => {
    expect(rowPatch(ROWS[0], { grade: '8', meeting: '', judgement: 'Bien.', conduct: '' })).toBeNull()
  })
})
