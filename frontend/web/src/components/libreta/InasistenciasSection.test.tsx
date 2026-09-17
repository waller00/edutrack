import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InasistenciasSection from './InasistenciasSection'
import type { AbsenceDayBoard, GradeBookDetail } from '@/lib/gradebook/types'

const detail = vi.fn<() => GradeBookDetail | null>()
vi.mock('@/contexts/LibretaContext', () => ({
  useLibreta: () => ({ gradeBookId: 'gb-1', detail: detail() }),
}))

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

function baseDetail(): GradeBookDetail {
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
    students: [],
  }
}

function board(over: Partial<AbsenceDayBoard> = {}): AbsenceDayBoard {
  return {
    date: '2026-09-14',
    hasClass: true,
    canMark: true,
    noClassReason: null,
    eventId: 'ev-1',
    canGrade: true,
    students: [
      {
        studentId: 's1',
        studentEnrollmentId: 'e1',
        firstName: 'Camila',
        lastName: 'Cabrera',
        documentId: null,
        absences: '1,5',
        absenceHundredths: 150,
        lates: 0,
        hasPhoto: false,
        dayMark: null,
      },
    ],
    ...over,
  }
}

describe('<InasistenciasSection />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    detail.mockReturnValue(baseDetail())
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (String(path).includes('/mine')) return { data: [] }
      if (String(path).includes('/absences/day') && init?.method === 'PUT') return { ok: true }
      if (String(path).includes('/absences/day')) return board()
      return {}
    })
  })

  it('no renderiza nada mientras la libreta no cargó', () => {
    detail.mockReturnValue(null)
    const { container } = render(<InasistenciasSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra planilla con combo de faltas/tardes y Guardar/Cancelar', async () => {
    render(<InasistenciasSection />)

    await waitFor(() => expect(screen.getByText(/CABRERA, CAMILA/i)).toBeInTheDocument())
    expect(screen.getByText(/Acu\. F\.: 1,5/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Inasistencia de Cabrera, Camila/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Falta$/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Llegada tarde/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^Media falta$/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Presente/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /0,5/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guardar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancelar/i })).toBeInTheDocument()
  })

  it('muestra el día de la semana sin S/H y deja el combo activo', async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/mine')) return { data: [] }
      if (String(path).includes('/absences/day')) {
        return board({
          date: '2026-09-15',
          hasClass: false,
          canMark: true,
          noClassReason: 'Sin horario',
          eventId: 'ev-anchor',
        })
      }
      return {}
    })

    render(<InasistenciasSection />)

    await waitFor(() => expect(screen.getByLabelText(/Día de la semana/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/Día de la semana/i)).toHaveTextContent(/Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo/)
    expect(screen.queryByText(/S\/H/i)).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Inasistencia/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Inasistencia de Cabrera, Camila/i)).toBeEnabled()
  })

  it('guarda el borrador al confirmar Guardar', async () => {
    const user = userEvent.setup()
    render(<InasistenciasSection />)
    await waitFor(() => expect(screen.getByLabelText(/Inasistencia de Cabrera, Camila/i)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText(/Inasistencia de Cabrera, Camila/i), 'ABSENT_100')
    await user.click(screen.getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/gradebook/gb-1/absences/day',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"status":"ABSENT"'),
        }),
      )
    })
  })

  it('abre el detalle al hacer click en el nombre', async () => {
    const user = userEvent.setup()
    apiMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/mine')) return { data: [] }
      if (String(path).includes('/absences/day') && !String(path).includes('/students/')) return board()
      if (String(path).includes('/students/s1/absences')) {
        return {
          student: {
            studentId: 's1',
            firstName: 'Camila',
            lastName: 'Cabrera',
            documentId: null,
            hasPhoto: false,
          },
          overall: { absenceHundredths: 150, absences: '1,5', lates: 0, justifiedCount: 0 },
          bySubject: [
            {
              subjectId: 'sub-1',
              subjectName: 'Biología',
              absenceHundredths: 150,
              absences: '1,5',
              entries: [
                {
                  entryId: 'en1',
                  status: 'ABSENT',
                  absenceWeightHundredths: 100,
                  weightHundredths: 100,
                  label: 'FALTA',
                  note: null,
                  ymd: '2026-04-07',
                  startAt: '',
                  endAt: '',
                  subjectId: 'sub-1',
                  subject: 'Biología',
                  title: null,
                },
              ],
            },
          ],
          entries: [],
        }
      }
      return {}
    })

    render(<InasistenciasSection />)
    await waitFor(() => expect(screen.getByText(/CABRERA, CAMILA/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /CABRERA, CAMILA/i }))
    await waitFor(() => expect(screen.getByText(/Inasistencias de: CABRERA CAMILA/i)).toBeInTheDocument())
    expect(screen.getByText(/Falta: 1,5/i)).toBeInTheDocument()
  })
})
