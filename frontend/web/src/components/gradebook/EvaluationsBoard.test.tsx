import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EvaluationsBoard from './EvaluationsBoard'
import type { GradeBookDetail } from '@/lib/gradebook/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('@/lib/api/binary', () => ({
  apiBlob: vi.fn().mockResolvedValue(null),
}))

const EMS_SCALE = {
  id: 'sc-12',
  name: 'Numérica 1 a 12',
  kind: 'NUMERIC',
  decimals: 0,
  minValueHundredths: 100,
  maxValueHundredths: 1200,
  levels: [],
}

function detail(): GradeBookDetail {
  return {
    id: 'gb-1',
    status: 'ACTIVE',
    schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
    course: { id: 'c1', name: '5 EMS', code: '5EMS', level: 'EMS' },
    courseOfferingId: 'off-1',
    orientation: null,
    subject: { id: 'sub-1', name: 'Física', code: 'FIS' },
    teacher: { id: 't1', name: 'Jorge', username: 'jorge' },
    access: { level: 'OWNER', canGrade: true },
    studentCount: 1,
    students: [
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Benítez', documentId: null, hasPhoto: false },
    ],
  }
}

type Board = { assessments: unknown[]; grades: unknown[] }

function respond(board: Board = { assessments: [], grades: [] }) {
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const url = String(path)
    if (init?.method === 'POST' && url.endsWith('/assessments')) return { data: { id: 'nueva' } }
    if (init?.method) return {}
    // Sin Moodle configurado el panel de importación se oculta.
    if (url.includes('/moodle/preview')) throw new Error('Moodle no disponible')
    if (url.includes('/grades-board')) return { ...board, periodGrades: [], periodStates: [] }
    if (url.includes('/options')) {
      return {
        periods: [{ id: 'p1', code: 'MAR_ABR', name: 'Marzo – Abril', kind: 'TRAMO' }],
        // La primera activa es la 1–10: antes la libreta la elegía también para bachillerato.
        scales: [{ ...EMS_SCALE, id: 'sc-10', name: 'Numérica 1 a 10', maxValueHundredths: 1000 }, EMS_SCALE],
        activityTypes: [{ id: 'oral', code: 'ORAL', name: 'Oral', scope: 'GLOBAL', category: 'ORAL' }],
        periodScale: EMS_SCALE,
      }
    }
    if (url.includes('/mine') || url.endsWith('/assessments')) return { data: [] }
    return {}
  })
}

function callBody(method: string, suffix: string) {
  const call = apiMock.mock.calls.find(
    ([path, init]) => String(path).endsWith(suffix) && (init as RequestInit | undefined)?.method === method,
  )
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null
}

describe('<EvaluationsBoard />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('la carta crea una nota suelta con la escala del nivel: en bachillerato hay 11 y 12', async () => {
    respond()
    const user = userEvent.setup()
    render(<EvaluationsBoard gradeBookId="gb-1" detail={detail()} />)

    await user.click(await screen.findByRole('button', { name: 'Agregar calificación a Benítez, Ana' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Calificación' }), '12')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(callBody('PUT', '/assessments/nueva/grades')).not.toBeNull())
    expect(callBody('POST', '/assessments')).toMatchObject({ scope: 'INDIVIDUAL', gradingScaleId: 'sc-12' })
    expect(callBody('PUT', '/assessments/nueva/grades').entries[0]).toMatchObject({
      valueHundredths: 1200,
      isAbsent: false,
    })
  })

  it('"No rindió" se guarda como tal, sin nota', async () => {
    respond()
    const user = userEvent.setup()
    render(<EvaluationsBoard gradeBookId="gb-1" detail={detail()} />)

    await user.click(await screen.findByRole('button', { name: 'Agregar calificación a Benítez, Ana' }))
    await user.click(screen.getByRole('checkbox', { name: 'No rindió' }))
    expect(screen.getByRole('combobox', { name: 'Calificación' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(callBody('PUT', '/assessments/nueva/grades')).not.toBeNull())
    expect(callBody('PUT', '/assessments/nueva/grades').entries[0]).toMatchObject({
      valueHundredths: null,
      isAbsent: true,
    })
  })

  it('editar la nota de una evaluación del grupo no le cambia título ni fecha a todos', async () => {
    respond({
      assessments: [
        {
          id: 'escrito',
          periodId: 'p1',
          period: null,
          date: '2026-04-10',
          title: 'Escrito 1',
          scope: 'GROUP',
          activityType: null,
          gradingScale: EMS_SCALE,
        },
      ],
      grades: [
        {
          assessmentId: 'escrito',
          studentId: 's1',
          valueHundredths: 800,
          isAbsent: false,
          comment: null,
          gradedAt: '2026-04-10T15:00:00.000Z',
          gradedByName: 'Jorge',
        },
      ],
    })
    const user = userEvent.setup()
    render(<EvaluationsBoard gradeBookId="gb-1" detail={detail()} />)

    await user.click(await screen.findByRole('button', { name: /Mostrar detalle/ }))
    await user.click(screen.getByRole('button', { name: 'Editar calificación' }))
    const form = screen.getByText(/Editar calificación — Benítez, Ana/).closest('form')!
    expect(within(form).queryByLabelText('Fecha')).not.toBeInTheDocument()
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Calificación' }), '11')
    await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(callBody('PUT', '/assessments/escrito/grades')).not.toBeNull())
    expect(callBody('PATCH', '/assessments/escrito')).toBeNull()
    expect(callBody('PUT', '/assessments/escrito/grades').entries[0]).toMatchObject({ valueHundredths: 1100, comment: null })
  })
})
