import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GradeDropsReport, LowGradesReport, StreaksTab, ThresholdsTab } from './ReportTabs'
import GradeFollowUp from './GradeFollowUp'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => null }))

const mockedApi = vi.mocked(api)
const student = { studentId: 'st-1', firstName: 'Ana', lastName: 'Díaz', courseName: '7 EBI' }

function respond(routes: Record<string, unknown>) {
  mockedApi.mockImplementation(async (path: string) => {
    const match = Object.keys(routes).find((key) => String(path).includes(key))
    return (match ? routes[match] : { data: [] }) as never
  })
}

const LOW_GRADES = {
  period: { name: '1.ª Entrega' },
  rows: [{ courseOfferingId: 'o1', courseName: '7 EBI', orientationName: null, subjectName: 'Matemática', graded: 20, low: 5, percent: 25, pending: 2 }],
  courses: [{ courseOfferingId: 'o1', courseName: '7 EBI', graded: 20, low: 5, percent: 25 }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('faltas', () => {
  it('faltas seguidas: dice si la racha sigue abierta', async () => {
    respond({ '/absence-streaks': { data: [{ ...student, from: '2026-10-05', to: '2026-10-07', days: 3, open: true }] } })
    render(<StreaksTab />)
    expect(await screen.findByText('Sigue faltando')).toBeInTheDocument()
    expect(screen.getByText('Díaz, Ana')).toBeInTheDocument()
  })

  it('18 / 25 faltas: el umbral es texto, no sólo color', async () => {
    respond({ '/absence-thresholds': { data: [{ ...student, absenceHundredths: 2550, threshold: 2500 }] } })
    render(<ThresholdsTab />)
    expect(await screen.findByText('25+')).toBeInTheDocument()
    expect(screen.getByText('25,5')).toBeInTheDocument()
  })
})

describe('notas', () => {
  it('notas bajas: "n de N" con el porcentaje, del boletín que le pasan', async () => {
    respond({ '/low-grades': LOW_GRADES })
    render(<LowGradesReport periodId="e1" />)

    expect(await screen.findByText('Matemática')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/admin/student-reports/low-grades?periodId=e1')
    expect(screen.getAllByText('5 de 20')).toHaveLength(2)
    expect(screen.getAllByText('25 %')).toHaveLength(2)
  })

  it('sin boletín elegido no pide nada', () => {
    render(<LowGradesReport periodId="" />)
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('bajas de boletín: avisa cuando es el primero', async () => {
    respond({ '/grade-drops': { period: { name: '1.ª Entrega' }, previous: null, rows: [] } })
    render(<GradeDropsReport periodId="e1" />)
    expect(await screen.findByText(/Es el primer boletín/)).toBeInTheDocument()
  })
})

describe('<GradeFollowUp />', () => {
  const periods = {
    data: [
      { id: 'e1', name: '1.ª Entrega', level: 'EBI', closesOn: '2020-05-01' },
      { id: 'e2', name: '2.ª Entrega', level: 'EBI', closesOn: '2020-07-01' },
    ],
  }

  it('un solo boletín para las dos listas: la última reunión que ya pasó', async () => {
    respond({
      '/periods?reportCard=true': periods,
      '/low-grades': LOW_GRADES,
      '/grade-drops': { period: { name: '2.ª Entrega' }, previous: { name: '1.ª Entrega' }, rows: [] },
    })
    render(<GradeFollowUp />)

    expect(await screen.findByRole('heading', { name: 'Notas bajas por curso y materia' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bajaron respecto del boletín anterior' })).toBeInTheDocument()
    await waitFor(() => {
      expect(mockedApi).toHaveBeenCalledWith('/admin/student-reports/low-grades?periodId=e2')
      expect(mockedApi).toHaveBeenCalledWith('/admin/student-reports/grade-drops?periodId=e2')
    })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
  })

  it('cambiar el boletín recarga las dos', async () => {
    respond({
      '/periods?reportCard=true': periods,
      '/low-grades': LOW_GRADES,
      '/grade-drops': { period: { name: '1.ª Entrega' }, previous: null, rows: [] },
    })
    render(<GradeFollowUp />)
    await screen.findByRole('heading', { name: 'Notas bajas por curso y materia' })

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'e1' } })

    await waitFor(() => {
      expect(mockedApi).toHaveBeenCalledWith('/admin/student-reports/low-grades?periodId=e1')
      expect(mockedApi).toHaveBeenCalledWith('/admin/student-reports/grade-drops?periodId=e1')
    })
  })
})
