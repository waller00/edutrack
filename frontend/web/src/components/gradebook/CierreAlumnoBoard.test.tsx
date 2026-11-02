import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/** La carta de un alumno: el cierre abre en "Todo el grupo". */
function openStudentView() {
  fireEvent.click(screen.getByRole('button', { name: 'Alumno por alumno' }))
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
              meetingValueHundredths: 700,
              conceptualJudgement: 'Buen avance.',
              descriptor: { label: 'Aceptable', colorToken: 'green', iconToken: 'check', isAlert: false },
            },
          ],
        }
      }
      return {}
    })
  })

  it('muestra la tabla con C (conducta) y R (rendimiento, combo 1-10)', async () => {
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    openStudentView()

    await waitFor(() => expect(screen.getByText(/Calificaciones y juicios/i)).toBeInTheDocument())
    expect(screen.getAllByText(/Marzo – Abril/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('R (rendimiento) de Marzo – Abril')).toHaveValue('7')
    expect(screen.getByLabelText('C (conducta) de Marzo – Abril')).toHaveValue('')
    expect(screen.getByText(/C es la conducta y R el rendimiento/)).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: '7' }).length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue(/Buen avance/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Imprimir cierre del alumno/i })).toBeInTheDocument()
    expect(screen.getByText(/juicio de reunión/i)).toBeInTheDocument()
  })

  it('guarda el borrador al confirmar', async () => {
    const user = userEvent.setup()
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    openStudentView()
    await waitFor(() => expect(screen.getByLabelText('R (rendimiento) de Marzo – Abril')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('R (rendimiento) de Marzo – Abril'), '8')
    await user.click(screen.getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/gradebook/gb-1/students/s1/closure',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"meetingValueHundredths":800'),
        }),
      )
    })
  })

  it('guardar sólo la R manda sólo la R: no pisa la C ni el juicio', async () => {
    const user = userEvent.setup()
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    openStudentView()
    await waitFor(() => expect(screen.getByLabelText('R (rendimiento) de Marzo – Abril')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('R (rendimiento) de Marzo – Abril'), '9')
    await user.click(screen.getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([path, init]) =>
        String(path).endsWith('/closure') && (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        entries: [{ periodId: 'p-1', meetingValueHundredths: 900 }],
      })
    })
  })

  it('en bachillerato ofrece 11 y 12, y una R de 11 no se borra al guardar otra cosa', async () => {
    const CONDUCT = [{ valueHundredths: 300, label: '3' }]
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/mine')) return { data: [] }
      if (String(path).includes('/grades-board')) return { assessments: [], grades: [] }
      if (String(path).includes('/closure')) {
        return {
          student: detail().students[0],
          canGrade: true,
          scale: { minValueHundredths: 100, maxValueHundredths: 1200, decimals: 0, levels: [] },
          conduct: CONDUCT,
          periods: [
            {
              periodId: 'p-1',
              code: 'ENTREGA_1',
              name: '1.ª Entrega',
              status: 'OPEN',
              canEdit: true,
              requiresGeneralGrade: true,
              requiresConceptualJudgement: false,
              assessmentCount: 0,
              meetingValueHundredths: 1100,
              conceptualJudgement: null,
              descriptor: null,
            },
          ],
        }
      }
      return {}
    })
    const user = userEvent.setup()
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    openStudentView()
    await waitFor(() => expect(screen.getByLabelText('R (rendimiento) de 1.ª Entrega')).toHaveValue('11'))
    expect(screen.getAllByRole('option', { name: '12' }).length).toBeGreaterThan(0)

    await user.selectOptions(screen.getByLabelText('C (conducta) de 1.ª Entrega'), '3')
    await user.click(screen.getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([path, init]) =>
        String(path).endsWith('/closure') && (init as RequestInit | undefined)?.method === 'PUT',
      )
      // Sólo la C: antes la R de 11 se leía vacía y viajaba como null.
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        entries: [{ periodId: 'p-1', conductValueHundredths: 300 }],
      })
    })
  })

  it('no cambia de alumno con cambios sin guardar si no se confirma', async () => {
    const twoStudents = {
      ...detail(),
      studentCount: 2,
      students: [
        ...detail().students,
        { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Luis', lastName: 'Díaz', documentId: null, hasPhoto: false },
      ],
    }
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={twoStudents} />)
    openStudentView()
    await waitFor(() => expect(screen.getByLabelText('R (rendimiento) de Marzo – Abril')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('R (rendimiento) de Marzo – Abril'), '9')
    const picker = screen.getByRole('combobox', { name: 'Alumno' })
    await user.click(picker)
    await user.click(screen.getByRole('option', { name: /DÍAZ, Luis/ }))

    expect(confirm).toHaveBeenCalled()
    expect(picker).toHaveValue('1. CABRERA, Camila')
    expect(screen.getByLabelText('R (rendimiento) de Marzo – Abril')).toHaveValue('9')
    // Las notas de la libreta se piden una sola vez.
    expect(apiMock.mock.calls.filter(([path]) => String(path).includes('/grades-board'))).toHaveLength(1)
    confirm.mockRestore()
  })

  it('carga la conducta (C) de la asignatura', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/mine')) return { data: [] }
      if (String(path).includes('/grades-board')) return { assessments: [], grades: [] }
      if (String(path).includes('/closure')) {
        return {
          student: detail().students[0],
          canGrade: true,
          conduct: [
            { valueHundredths: 300, label: '3' },
            { valueHundredths: 400, label: '4' },
          ],
          periods: [
            {
              periodId: 'p-1',
              code: 'ENTREGA_1',
              name: '1.ª Entrega',
              status: 'OPEN',
              canEdit: true,
              isMeeting: true,
              requiresGeneralGrade: true,
              requiresConceptualJudgement: false,
              assessmentCount: 0,
              meetingValueHundredths: 800,
              conceptualJudgement: null,
              conductValueHundredths: null,
              descriptor: null,
            },
          ],
        }
      }
      return {}
    })
    const user = userEvent.setup()
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    openStudentView()
    await waitFor(() => expect(screen.getByLabelText('C (conducta) de 1.ª Entrega')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('C (conducta) de 1.ª Entrega'), '3')
    await user.click(screen.getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      const call = apiMock.mock.calls.find(([path, init]) =>
        String(path).endsWith('/closure') && (init as RequestInit | undefined)?.method === 'PUT',
      )
      expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
        entries: [{ periodId: 'p-1', conductValueHundredths: 300 }],
      })
    })
  })

  it('abre en todo el grupo, con las dos vistas a la vista', () => {
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)
    expect(screen.getByRole('button', { name: 'Todo el grupo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Alumno por alumno' })).toHaveAttribute('aria-pressed', 'false')
    // El buscador de alumnos es de la carta: en la vista del grupo no aparece.
    expect(screen.queryByRole('combobox', { name: 'Alumno' })).toBeNull()
  })

  it('un nombre de lo que falta en el panel abre la carta de ese alumno', async () => {
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/gradebook/gb-1/periods') {
        return { data: [{ periodId: 'p-1', name: '1.ª Entrega', kind: 'ENTREGA', isMeeting: true, status: 'OPEN' }] }
      }
      if (path === '/gradebook/gb-1/endorsements') return { data: [] }
      if (path === '/gradebook/gb-1/periods/p-1') {
        return {
          period: { id: 'p-1', name: '1.ª Entrega', judgementLabel: 'Informe de actuación' },
          state: { status: 'OPEN', closedAt: null, closedLate: false, reopenReason: null },
          blockers: [{ code: 'MISSING_GRADES', studentIds: ['s1'] }],
          students: [{ studentId: 's1', lastName: 'Cabrera', firstName: 'Camila' }],
        }
      }
      return base(path, init)
    })
    render(<CierreAlumnoBoard gradeBookId="gb-1" detail={detail()} />)

    const missing = await screen.findByText('Falta para cerrar')
    fireEvent.click(within(missing.closest('div')!).getByRole('button', { name: 'Cabrera, Camila' }))

    expect(screen.getByRole('button', { name: 'Alumno por alumno' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByLabelText('R (rendimiento) de Marzo – Abril')).toBeInTheDocument()
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
              meetingValueHundredths: null,
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
    openStudentView()
    await waitFor(() => expect(screen.getByLabelText('C (conducta) de APE Febrero')).toBeInTheDocument())
    expect(screen.getByLabelText('C (conducta) de APE Febrero').tagName).toBe('SPAN')
    expect(screen.getByLabelText('R (rendimiento) de APE Febrero').tagName).toBe('SPAN')
    expect(screen.queryByRole('textbox', { name: /de APE Febrero/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('C (conducta) de APE Febrero')).toHaveTextContent('—')
    // El estado en palabras, no un ícono de color.
    expect(screen.getByText('Se habilita el 01/02/2099')).toBeInTheDocument()
  })
})
