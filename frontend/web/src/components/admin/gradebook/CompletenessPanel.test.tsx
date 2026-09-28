import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CompletenessPanel from './CompletenessPanel'
import { api } from '@/lib/api/client'
import type { ReportCardPeriod } from '@/lib/gradebook/report-card-periods'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

// El backend devuelve `id`, no `periodId`: mockear otra forma era lo que tapaba el 404.
const PERIODS: { data: ReportCardPeriod[] } = {
  data: [
    { id: 'e1', name: '1.ª Entrega', level: 'EBI', closesOn: '2020-05-01' },
    { id: 's1', name: '1.er semestre', level: 'EMS', closesOn: '2020-07-01' },
  ],
}

function row(over: Record<string, unknown> = {}) {
  return {
    gradeBookId: 'gb-1',
    subjectName: 'Matemática',
    courseName: '8 EBI',
    teacherName: 'Ana Benítez',
    periodStatus: 'OPEN',
    rosterSize: 20,
    expectsAssessments: true,
    assessmentCount: 3,
    hasNoAssessments: false,
    missingAssessmentGrades: 0,
    requiresGrade: true,
    missingGrades: 6,
    requiresJudgement: true,
    missingJudgements: 0,
    meetingGradedCount: 0,
    complete: false,
    ...over,
  }
}

function respond(rows: unknown[], notified = 1) {
  mockedApi.mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve({ ok: true, notified } as never)
    if (String(path).includes('/completeness')) return Promise.resolve({ period: { name: '1.ª Entrega' }, data: rows } as never)
    return Promise.resolve(PERIODS as never)
  })
}

async function pickPeriod(id = 'e1') {
  fireEvent.change(await screen.findByLabelText('Reunión'), { target: { value: id } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<CompletenessPanel />', () => {
  it('pide sólo las reuniones de boletín y las agrupa por nivel', async () => {
    respond([])
    render(<CompletenessPanel />)

    await screen.findByLabelText('Reunión')
    expect(String(mockedApi.mock.calls[0][0])).toContain('reportCard=true')
    expect(screen.getByRole('group', { name: 'Ciclo básico' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Bachillerato' })).toBeInTheDocument()
  })

  it('carga el control con el id del período, no con su nombre', async () => {
    respond([row()])
    render(<CompletenessPanel />)
    await pickPeriod('s1')

    await waitFor(() =>
      expect(mockedApi.mock.calls.some(([path]) => String(path) === '/admin/gradebook/completeness?periodId=s1')).toBe(true),
    )
  })

  it('muestra por columna qué falta: evaluaciones, C y juicio', async () => {
    respond([row({ missingAssessmentGrades: 4 })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByText('3 cargadas · faltan 4 notas')).toBeInTheDocument()
    expect(screen.getByText('Faltan 6')).toBeInTheDocument()
    expect(screen.getByText('Ana Benítez')).toBeInTheDocument()
  })

  it('marca la libreta sin evaluaciones', async () => {
    respond([row({ hasNoAssessments: true, assessmentCount: 0, missingGrades: 0 })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByText('Sin evaluaciones')).toBeInTheDocument()
  })

  it('por defecto esconde las que están al día', async () => {
    respond([row(), row({ gradeBookId: 'gb-2', subjectName: 'Historia', complete: true })])
    render(<CompletenessPanel />)
    await pickPeriod()

    await screen.findByText(/8 EBI · Matemática/)
    expect(screen.queryByText(/Historia/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Sólo las que faltan'))
    expect(await screen.findByText(/Historia/)).toBeInTheDocument()
  })

  it('el aviso manda sólo el período: el detalle lo arma el backend', async () => {
    respond([row()])
    render(<CompletenessPanel />)
    await pickPeriod()

    fireEvent.click(await screen.findByRole('button', { name: /Avisar al docente/ }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      expect(String(post?.[0])).toBe('/admin/gradebook/completeness/gb-1/request')
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ periodId: 'e1' })
    })
    expect(await screen.findByText('Avisado')).toBeInTheDocument()
  })

  it('no dice "Avisado" si no le llegó a nadie', async () => {
    respond([row()], 0)
    render(<CompletenessPanel />)
    await pickPeriod()

    fireEvent.click(await screen.findByRole('button', { name: /Avisar al docente/ }))
    expect(await screen.findByText('Sin docente a quien avisar')).toBeInTheDocument()
  })

  it('no deja avisar si la libreta no tiene titular', async () => {
    respond([row({ teacherName: null })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByRole('button', { name: /Avisar al docente/ })).toBeDisabled()
  })

  it('celebra cuando no falta nada', async () => {
    respond([row({ complete: true })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByText('Todas las libretas están al día para esta reunión.')).toBeInTheDocument()
  })

  it('muestra el error sin dejar la pantalla en blanco', async () => {
    mockedApi.mockImplementation((path: string) =>
      String(path).includes('/completeness') ? Promise.reject(new Error('Sin permiso')) : Promise.resolve(PERIODS as never),
    )
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin permiso')
  })
})
