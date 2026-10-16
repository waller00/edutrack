import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CompletenessPanel, { bulkNoticeText, isDone, rowLabel } from './CompletenessPanel'
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
    requiresConduct: true,
    missingConduct: 0,
    requiresGroupReport: true,
    missingGroupReport: false,
    complete: false,
    ...over,
  }
}

function respond(rows: unknown[], notified = 1) {
  mockedApi.mockImplementation((path: string, init?: RequestInit) => {
    if (String(path).endsWith('/request-all')) return Promise.resolve({ teachers: 2, gradeBooks: 3, withoutTeacher: 1 } as never)
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

  it('muestra por columna qué falta: evaluaciones, R, C, juicio e informe del grupo', async () => {
    respond([row({ missingAssessmentGrades: 4, missingConduct: 2, missingGroupReport: true })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByText('3 cargadas · faltan 4 notas')).toBeInTheDocument()
    expect(screen.getByText('Faltan 6')).toBeInTheDocument()
    expect(screen.getByText('Faltan 2')).toBeInTheDocument()
    expect(screen.getByText('▲ Falta')).toBeInTheDocument()
    for (const header of ['Rendimiento (R)', 'Conducta (C)', 'Informe del grupo']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    expect(screen.getByText('Ana Benítez')).toBeInTheDocument()
  })

  it('con sólo notas sueltas, dice cuántos alumnos no tienen ninguna', async () => {
    respond([row({ studentsWithoutGrades: 2, complete: false })])
    render(<CompletenessPanel />)
    await pickPeriod()

    expect(await screen.findByText('3 cargadas · 2 alumnos sin notas')).toBeInTheDocument()
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
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ periodId: 'e1', stage: 'before' })
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

  it('nombra la libreta con la orientación del grupo', async () => {
    respond([row({ courseName: '5.º', orientationName: 'Científico' })])
    render(<CompletenessPanel />)
    await pickPeriod()
    expect(await screen.findByText('5.º — Científico · Matemática')).toBeInTheDocument()
  })

  it('después de la reunión mira el cierre, y avisa con esa etapa', async () => {
    respond([row({ complete: true, periodStatus: 'OPEN' })])
    render(<CompletenessPanel />)
    await pickPeriod()
    await screen.findByText(/Todas las libretas están al día/)

    fireEvent.click(screen.getByRole('radio', { name: 'Después de la reunión' }))

    expect(await screen.findByText('Abierto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Avisar al docente/ }))
    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ periodId: 'e1', stage: 'after' })
    })
  })

  it('muestra cuándo se avisó por última vez', async () => {
    respond([row({ lastRequestedAt: { before: '2026-06-10T15:00:00.000Z', after: null } })])
    render(<CompletenessPanel />)
    await pickPeriod()
    expect(await screen.findByText('Avisado el 10/06/2026')).toBeInTheDocument()
  })

  it('avisa a todos de una vez y dice a cuántos docentes', async () => {
    respond([row(), row({ gradeBookId: 'gb-2', subjectName: 'Historia' })])
    render(<CompletenessPanel />)
    await pickPeriod()

    fireEvent.click(await screen.findByRole('button', { name: 'Avisar a todos (2)' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Se avisó a 2 docentes por 3 libretas')
    const post = mockedApi.mock.calls.find(([path]) => String(path).endsWith('/request-all'))
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ periodId: 'e1', stage: 'before' })
  })
})

describe('auxiliares del control', () => {
  it('cada etapa tiene su "al día"', () => {
    const r = row({ complete: true, periodStatus: 'OPEN' }) as never
    expect(isDone(r, 'before')).toBe(true)
    expect(isDone(r, 'after')).toBe(false)
  })

  it('el nombre sin orientación no deja un guion suelto', () => {
    expect(rowLabel({ courseName: '1.º', orientationName: null, subjectName: 'Matemática' })).toBe('1.º · Matemática')
  })

  it('el resultado del aviso masivo en singular y sin titulares', () => {
    expect(bulkNoticeText({ teachers: 1, gradeBooks: 1, withoutTeacher: 0 })).toBe('Se avisó a 1 docente por 1 libreta, un aviso por docente.')
    expect(bulkNoticeText({ teachers: 0, gradeBooks: 0, withoutTeacher: 2 })).toContain('no tienen titular')
  })
})
