import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentReports, { alertDetail } from './StudentReports'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => null }))

const replace = vi.fn()
let tab: string | null = null
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => ({ get: () => tab }),
}))

const mockedApi = vi.mocked(api)
const student = { studentId: 'st-1', firstName: 'Ana', lastName: 'Díaz', courseName: '7 EBI' }

function respond(routes: Record<string, unknown>) {
  mockedApi.mockImplementation(async (path: string) => {
    const match = Object.keys(routes).find((key) => String(path).includes(key))
    return (match ? routes[match] : { data: [] }) as never
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  tab = null
})

describe('alertDetail', () => {
  const alert = (type: string, key: string, payload: Record<string, unknown>) =>
    ({ id: 'a', type, key, createdAt: '2026-10-09T12:00:00Z', payload }) as Parameters<typeof alertDetail>[0]

  it('explica cada alerta en palabras', () => {
    expect(alertDetail(alert('ABSENCE_THRESHOLD', '18', { absenceHundredths: 1850 }))).toBe('Llegó a 18 faltas (lleva 18,5).')
    expect(alertDetail(alert('ABSENCE_STREAK', '2026-10-05', { days: 3, from: '2026-10-05' }))).toBe('3 días seguidos desde el 05/10.')
    expect(
      alertDetail(alert('GRADE_DROP', 'e2:mat', { subjectName: 'Matemática', previous: 800, current: 650, previousName: '1.ª Entrega', periodName: '2.ª Entrega' })),
    ).toBe('Matemática: de 8 (1.ª Entrega) a 6,5 (2.ª Entrega).')
  })
})

describe('<StudentReports />', () => {
  it('abre en la bandeja de alertas y cambia de pestaña por la URL', async () => {
    respond({
      '/alerts': {
        data: [{ id: 'a1', type: 'ABSENCE_THRESHOLD', key: '18', createdAt: '2026-10-09T12:00:00Z', payload: { ...student, absenceHundredths: 1800 } }],
      },
    })
    render(<StudentReports />)

    expect(await screen.findByText('Umbral de faltas')).toBeInTheDocument()
    expect(screen.getByText('Díaz, Ana')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Faltas seguidas' }))
    expect(replace).toHaveBeenCalledWith('/admin/reportes?tab=seguidas')
  })

  it('faltas seguidas: dice si la racha sigue abierta', async () => {
    tab = 'seguidas'
    respond({ '/absence-streaks': { data: [{ ...student, from: '2026-10-05', to: '2026-10-07', days: 3, open: true }] } })
    render(<StudentReports />)

    expect(await screen.findByText('Sigue faltando')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Faltas seguidas' })).toHaveAttribute('aria-selected', 'true')
  })

  it('18 / 25 faltas: el umbral es texto, no sólo color', async () => {
    tab = 'faltas'
    respond({ '/absence-thresholds': { data: [{ ...student, absenceHundredths: 2550, threshold: 2500 }] } })
    render(<StudentReports />)

    expect(await screen.findByText('25+')).toBeInTheDocument()
    expect(screen.getByText('25,5')).toBeInTheDocument()
  })

  it('notas bajas: pide el boletín y muestra "n de N" con el porcentaje', async () => {
    tab = 'notas'
    respond({
      '/periods?reportCard=true': { data: [{ id: 'e1', name: '1.ª Entrega', level: 'EBI', closesOn: '2020-05-01' }] },
      '/low-grades': {
        period: { name: '1.ª Entrega' },
        rows: [{ courseOfferingId: 'o1', courseName: '7 EBI', orientationName: null, subjectName: 'Matemática', graded: 20, low: 5, percent: 25, pending: 2 }],
        courses: [{ courseOfferingId: 'o1', courseName: '7 EBI', graded: 20, low: 5, percent: 25 }],
      },
    })
    render(<StudentReports />)

    await waitFor(() =>
      expect(mockedApi.mock.calls.some(([path]) => String(path) === '/admin/student-reports/low-grades?periodId=e1')).toBe(true),
    )
    expect(await screen.findByText('Matemática')).toBeInTheDocument()
    expect(screen.getAllByText('5 de 20')).toHaveLength(2)
    expect(screen.getAllByText('25 %')).toHaveLength(2)
  })

  it('bajas de boletín: avisa cuando es el primero', async () => {
    tab = 'bajas'
    respond({
      '/periods?reportCard=true': { data: [{ id: 'e1', name: '1.ª Entrega', level: 'EBI', closesOn: '2020-05-01' }] },
      '/grade-drops': { period: { name: '1.ª Entrega' }, previous: null, rows: [] },
    })
    render(<StudentReports />)

    expect(await screen.findByText(/Es el primer boletín/)).toBeInTheDocument()
  })
})
