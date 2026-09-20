import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CierreAlumnoBoard from './CierreAlumnoBoard'
import type { GradeBookDetail } from '@/lib/gradebook/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('@/lib/api/binary', () => ({
  apiBlob: vi.fn().mockResolvedValue(null),
}))

function detail(): GradeBookDetail {
  return {
    id: 'gb-1',
    status: 'ACTIVE',
    schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
    course: { id: 'c1', name: '8 EBI', code: '8EBI', level: 'EBI' },
    courseOfferingId: 'off-1',
    orientation: null,
    subject: { id: 'sub-1', name: 'Biología', code: 'BIO' },
    teacher: { id: 't1', name: 'Jorge', username: 'jorge' },
    access: { level: 'OWNER', canGrade: true },
    studentCount: 1,
    students: [
      {
        studentId: 's1',
        studentEnrollmentId: 'e1',
        firstName: 'Camila',
        lastName: 'Cabrera',
        documentId: '31000748',
        hasPhoto: false,
      },
    ],
  }
}

describe('<CierreAlumnoBoard />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/mine')) return { data: [] }
      if (String(path).includes('/grades-board')) return { assessments: [], grades: [] }
      if (String(path).includes('/closure')) {
        return {
          student: detail().students[0],
          canGrade: true,
          periods: [
            {
              periodId: 'p-1',
              code: 'MAR_ABR',
              name: 'Marzo – Abril',
              status: 'OPEN',
              canEdit: true,
              requiresGeneralGrade: true,
              requiresConceptualJudgement: true,
              assessmentCount: 0,
              valueHundredths: 700,
              conceptualJudgement: 'Buen avance.',
              descriptor: { label: 'Aceptable', colorToken: 'green', iconToken: 'check', isAlert: false },
            },
          ],
        }
      }
      return {}
    })
  })

  it('muestra la tabla de calificaciones y juicios con combo 1-10', async () => {
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)

    await waitFor(() => expect(screen.getByText(/Calificaciones y juicios/i)).toBeInTheDocument())
    expect(screen.getAllByText(/Marzo – Abril/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/Rendimiento de Marzo/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '7' })).toBeInTheDocument()
    expect(screen.getByDisplayValue(/Buen avance/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Imprimir cierre del alumno/i })).toBeInTheDocument()
    expect(screen.getByText(/juicio de reunión/i)).toBeInTheDocument()
  })

  it('guarda el borrador al confirmar', async () => {
    const user = userEvent.setup()
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    await waitFor(() => expect(screen.getByLabelText(/Rendimiento de Marzo/i)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText(/Rendimiento de Marzo/i), '8')
    await user.click(screen.getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/gradebook/gb-1/students/s1/closure',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"valueHundredths":800'),
        }),
      )
    })
  })

  it('no muestra combo ni textarea en períodos no habilitados', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/mine')) return { data: [] }
      if (String(path).includes('/grades-board')) return { assessments: [], grades: [] }
      if (String(path).includes('/closure')) {
        return {
          student: detail().students[0],
          canGrade: true,
          periods: [
            {
              periodId: 'p-future',
              code: 'APE_FEB',
              name: 'APE Febrero',
              status: 'OPEN',
              canEdit: false,
              requiresGeneralGrade: true,
              requiresConceptualJudgement: true,
              assessmentCount: 0,
              valueHundredths: null,
              conceptualJudgement: null,
              descriptor: null,
              startsOn: '2099-02-01',
            },
          ],
        }
      }
      return {}
    })

    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    await waitFor(() =>
      expect(screen.getByLabelText(/Rendimiento de APE Febrero/i)).toBeInTheDocument(),
    )
    expect(screen.queryByLabelText(/Rendimiento de APE Febrero/i)?.tagName).toBe('SPAN')
    expect(screen.queryByRole('textbox', { name: /Juicio de APE Febrero/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Rendimiento de APE Febrero/i)).toHaveTextContent('—')
    expect(screen.getByRole('button', { name: /Info de APE Febrero: Período no habilitado/i })).toBeInTheDocument()
  })
})
