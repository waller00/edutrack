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
  { studentId: 's1', lastName: 'Benítez', firstName: 'Ana', assessmentCount: 3, valueHundredths: null, meetingValueHundredths: 800, conceptualJudgement: 'Bien.', conductValueHundredths: null },
  { studentId: 's2', lastName: 'Cabrera', firstName: 'Luis', assessmentCount: 1, valueHundredths: null, meetingValueHundredths: null, conceptualJudgement: null, conductValueHundredths: null },
]

function respond(canEdit = true, groupReport: { body: string | null; updatedAt: string | null; required: boolean } = { body: null, updatedAt: null, required: true }) {
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && String(path).endsWith('/group-report')) {
      return { data: { body: JSON.parse(String(init.body)).body, updatedAt: '2026-05-10T15:00:00.000Z' } }
    }
    if (init?.method === 'PUT') return { ok: true }
    if (String(path).endsWith('/options')) {
      return {
        periods: [ENTREGA, { ...ENTREGA, id: 'p-e2', code: 'ENTREGA_2', name: '2.ª Entrega', startsOn: '2026-06-01', endsOn: '2026-08-31' }],
        periodScale: { minValueHundredths: 100, maxValueHundredths: 1200 },
        conduct: [
          { valueHundredths: 300, label: '3' },
          { valueHundredths: 400, label: '4' },
        ],
      }
    }
    return { period: ENTREGA, state: { status: 'OPEN' }, canEdit, students: ROWS, groupReport }
  })
}

describe('<CierreGrupoTable />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-10T15:00:00.000Z'))
  })

  it('carga C (conducta), R (rendimiento) e informe de todo el grupo y guarda sólo lo que cambió', async () => {
    respond()
    const user = userEvent.setup()
    render(<CierreGrupoTable gradeBookId="gb-1" />)

    await waitFor(() => expect(screen.getByLabelText('R (rendimiento) de Cabrera, Luis')).toBeInTheDocument())
    expect(screen.getByLabelText('R (rendimiento) de Benítez, Ana')).toHaveValue('8')

    await user.selectOptions(screen.getByLabelText('R (rendimiento) de Cabrera, Luis'), '11')
    await user.selectOptions(screen.getByLabelText('C (conducta) de Cabrera, Luis'), '4')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => {
      const put = apiMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
      expect(put?.[0]).toBe('/gradebook/gb-1/periods/p-e1/grades')
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({
        entries: [{ studentId: 's2', meetingValueHundredths: 1100, conductValueHundredths: 400 }],
      })
    })
  })

  it('el docente escribe el informe general del grupo, que la reunión pide para cerrar', async () => {
    respond()
    const user = userEvent.setup()
    render(<CierreGrupoTable gradeBookId="gb-1" />)

    expect(await screen.findByText('▲ Falta: se pide para cerrar la reunión')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Texto del informe del grupo'), 'Grupo trabajador.')
    await user.click(screen.getByRole('button', { name: 'Guardar informe' }))

    await waitFor(() => {
      const put = apiMock.mock.calls.find(([path]) => String(path).endsWith('/group-report'))
      expect(put?.[0]).toBe('/gradebook/gb-1/periods/p-e1/group-report')
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ body: 'Grupo trabajador.' })
    })
    expect(await screen.findByText('✓ Cargado')).toBeInTheDocument()
  })

  it('pide confirmar antes de cambiar de período con cambios sin guardar', async () => {
    respond()
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<CierreGrupoTable gradeBookId="gb-1" />)
    await waitFor(() => expect(screen.getByLabelText('R (rendimiento) de Cabrera, Luis')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('R (rendimiento) de Cabrera, Luis'), '7')
    await user.selectOptions(screen.getByLabelText('Período'), '2.ª Entrega')

    expect(confirm).toHaveBeenCalled()
    expect(screen.getByLabelText('Período')).toHaveValue('p-e1')
    confirm.mockRestore()
  })

  it('sin permiso se lee, no se edita', async () => {
    respond(false, { body: 'Buen grupo.', updatedAt: null, required: true })
    render(<CierreGrupoTable gradeBookId="gb-1" />)
    await waitFor(() => expect(screen.getByText('Bien.')).toBeInTheDocument())
    expect(screen.queryByLabelText('R (rendimiento) de Benítez, Ana')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.getByText('Buen grupo.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Texto del informe del grupo')).not.toBeInTheDocument()
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
    expect(rowPatch(ROWS[0], { meeting: '8', judgement: 'Bien.', conduct: '' })).toBeNull()
  })
})
