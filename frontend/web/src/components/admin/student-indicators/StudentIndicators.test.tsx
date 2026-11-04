import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentIndicators from './StudentIndicators'
import { api } from '@/lib/api/client'

const { routerMock, state } = vi.hoisted(() => ({
  routerMock: { replace: vi.fn(), push: vi.fn() },
  state: {
    query: '',
    permissions: [] as { id: string; scope: 'own' | 'all' }[],
    yearQuery: 'schoolYearId=y26',
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/admin/student-indicators',
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => ({ me: { id: 'u1', permissions: state.permissions } }) }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => ({
    loading: false,
    years: [
      { id: 'y25', code: 2025, label: 'Ciclo 2025', status: 'CLOSED' },
      { id: 'y26', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE' },
    ],
    activeId: 'y26',
    selectedId: state.yearQuery.endsWith('y25') ? 'y25' : 'y26',
    allYears: false,
    schoolYearScopedQuery: state.yearQuery,
  }),
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('recharts', async () => (await import('@/test/recharts-mock')).rechartsMock)

const mockedApi = vi.mocked(api)
const ANALYTICS = { id: 'academic-analytics.read', scope: 'all' as const }
const REPORTS = { id: 'student-reports.read', scope: 'all' as const }
const ATTENDANCE = { id: 'student-attendance.read', scope: 'all' as const }

const Y25 = { id: 'y25', code: 2025, label: 'Ciclo 2025', status: 'CLOSED' }
const Y26 = { id: 'y26', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE' }
const ana = { studentId: 'ana', firstName: 'Ana', lastName: 'Pérez', courseName: '7 EBI', level: 'EBI' }
const beto = { studentId: 'beto', firstName: 'Beto', lastName: 'Gómez', courseName: '8 EBI', level: 'EBI' }
const days = (studentDays: number, absentDays: number, justifiedDays = 0, lateDays = 0) => ({ studentDays, absentDays, justifiedDays, lateDays })
const counts = (over: Record<string, number> = {}) => ({
  enrolled: 0,
  leftWithdrawn: 0,
  leftTransferred: 0,
  inProgress: 0,
  promoted: 0,
  promotedWithPending: 0,
  repeated: 0,
  graduated: 0,
  graduatedWithPending: 0,
  pendingApe: 0,
  noResult: 0,
  notReenrolled: 0,
  continuationPending: 0,
  ...over,
})

const RESPONSES: Record<string, unknown> = {
  '/admin/gradebook/periods': {
    data: [
      { id: 'e1', name: '1.ª Entrega', level: 'EBI', closesOn: '2026-05-10' },
      { id: 'e2', name: '2.ª Entrega', level: 'EBI', closesOn: '2026-07-20' },
      { id: 'e3', name: '3.ª Entrega', level: 'EBI', closesOn: '2099-09-20' },
    ],
  },
  '/admin/student-reports/risk': {
    schoolYear: Y26,
    enrolled: 120,
    threshold: 3,
    references: [{ level: 'EBI', period: { id: 'e2', name: '2.ª Entrega' } }],
    counts: { students: 2, grades: 1, absences: 1, both: 0 },
    rows: [
      { ...ana, grades: { lowSubjects: 3, subjects: ['Física', 'Inglés', 'Matemática'], periodName: '2.ª Entrega' }, absenceHundredths: 400, absenceThreshold: null, streak: null, carried: 0, reasons: ['GRADES'], families: ['NOTAS'] },
      { ...beto, grades: null, absenceHundredths: 2600, absenceThreshold: 2500, streak: null, carried: 0, reasons: ['ABSENCES'], families: ['FALTAS'] },
    ],
  },
  '/admin/student-reports/attendance-trend': {
    schoolYear: Y26,
    months: ['2026-03', '2026-04'],
    byCourse: [
      {
        courseOfferingId: 'o7',
        courseName: '7 EBI',
        level: 'EBI',
        months: [
          { month: '2026-03', ...days(100, 10, 4, 2) },
          { month: '2026-04', ...days(100, 10, 4, 2) },
        ],
        total: days(200, 20, 8, 4),
      },
    ],
    total: {
      ...days(200, 20, 8, 4),
      months: [
        { month: '2026-03', ...days(100, 10, 4, 2) },
        { month: '2026-04', ...days(100, 10, 4, 2) },
      ],
    },
  },
  '/admin/student-reports/absence-streaks': { data: [{ ...ana, from: '2026-10-27', to: '2026-10-30', days: 4, open: true }] },
  '/admin/student-reports/absence-thresholds': { data: [{ ...beto, absenceHundredths: 2600, threshold: 2500 }] },
  '/admin/academic-analytics/dashboard': {
    scale: { name: 'Escala de 1 a 10' },
    referencePeriod: { id: 'e2', name: '2.ª Entrega' },
    students: { total: 100, atRisk: 5, improved: 30, declined: 20, compared: 80 },
    performance: {
      averageHundredths: 720,
      medianHundredths: 700,
      distribution: [
        { levelId: 'l1', label: 'Insuficiente', isAlert: true, count: 50 },
        { levelId: 'l2', label: 'Aceptable', isAlert: false, count: 150 },
      ],
      gradedCount: 200,
    },
    lowSubjects: { graded: 100, none: 60, one: 20, two: 10, threeOrMore: 10 },
    rules: [{ type: 'ALERT_SUBJECTS', threshold: 3 }],
    disclaimer: 'No decide promociones.',
  },
  '/admin/academic-analytics/comparison': {
    data: [
      { key: 'mat', label: 'Matemática', averageHundredths: 610, medianHundredths: 600, gradedCount: 140, studentCount: 140, alertCount: 45 },
      { key: 'ing', label: 'Inglés', averageHundredths: 780, medianHundredths: 800, gradedCount: 140, studentCount: 140, alertCount: 10 },
    ],
  },
  '/admin/academic-analytics/trajectory': {
    requestedYear: Y26,
    focusYear: Y25,
    byCourse: [
      { courseId: 'c7', courseName: '7 EBI', level: 'EBI', position: 1, ...counts({ enrolled: 30, promoted: 25, repeated: 3, leftWithdrawn: 2 }) },
      { courseId: 'c9', courseName: '9 EBI', level: 'EBI', position: 3, ...counts({ enrolled: 28, graduated: 26, repeated: 2 }) },
    ],
    total: counts({ enrolled: 58, promoted: 25, repeated: 5, graduated: 26, leftWithdrawn: 2, notReenrolled: 1 }),
    byYear: [{ ...Y25, ...counts({ enrolled: 58, promoted: 25, repeated: 5, graduated: 26, leftWithdrawn: 2, notReenrolled: 1 }) }],
    cohorts: [{ level: 'EBI', entryYear: 2023, entrants: 30, graduatedOnTime: 24, graduatedLate: 0, onTrack: 0, behind: 2, left: 4, unknown: 0 }],
  },
  '/admin/student-reports/low-grades': {
    period: { id: 'e2', name: '2.ª Entrega', level: 'EBI' },
    rows: [
      { courseOfferingId: 'o7', courseName: '7 EBI', orientationName: null, subjectName: 'Matemática', graded: 30, low: 12, percent: 40, pending: 0 },
      { courseOfferingId: 'o7', courseName: '7 EBI', orientationName: null, subjectName: 'Inglés', graded: 30, low: 3, percent: 10, pending: 0 },
    ],
    courses: [{ courseOfferingId: 'o7', courseName: '7 EBI', graded: 30, low: 13, percent: 43.3 }],
  },
  '/admin/student-reports/subjects-ape': {
    requestedYear: Y26,
    focusYear: Y25,
    students: { referred: 3, clearedByFebruary: 1, clearedLater: 1, stillOwing: 1 },
    byCourse: [{ courseId: 'c7', courseName: '7 EBI', position: 1, referred: 4, december: 1, february: 1, previa: 1, owed: 1, studentsReferred: 3 }],
    rows: [{ courseId: 'c7', courseName: '7 EBI', position: 1, subjectId: 'mat', subjectName: 'Matemática', referred: 4, december: 1, february: 1, previa: 1, owed: 1 }],
    carriedOver: { students: 2, subjects: 3 },
  },
  '/admin/student-reports/grade-drops': { period: { name: '2.ª Entrega' }, previous: { name: '1.ª Entrega' }, rows: [] },
}

const pathOf = (url: string) => url.split('?')[0]
const callsTo = (path: string) => mockedApi.mock.calls.map(([url]) => String(url)).filter((url) => pathOf(url) === path)

beforeEach(() => {
  vi.clearAllMocks()
  state.query = ''
  state.permissions = [ANALYTICS, REPORTS, ATTENDANCE]
  state.yearQuery = 'schoolYearId=y26'
  mockedApi.mockImplementation(async (url) => {
    const response = RESPONSES[pathOf(String(url))]
    if (!response) throw new Error(`sin respuesta para ${url}`)
    return response as never
  })
})

describe('Indicadores de estudiantes', () => {
  it('con los dos permisos ve todas las secciones y el resumen, cada número con su base', async () => {
    render(<StudentIndicators />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Resumen',
      'Rendimiento',
      'Materias y APE',
      'Asistencia',
      'Trayectoria',
      'Quién necesita atención',
    ])
    expect(await screen.findByText(/2 de 120 \(1,7 %\) estudiantes del ciclo/)).toBeInTheDocument()
    expect(await screen.findByText('90 %')).toBeInTheDocument()
    expect(await screen.findByText(/40 de 100 \(40 %\) estudiantes con notas tienen al menos una materia baja en 2.ª Entrega/)).toBeInTheDocument()
    expect(await screen.findByText(/51 de 58 \(87,9 %\) matriculados en Ciclo 2025 promovieron o egresaron/)).toBeInTheDocument()
    // «Para mirar primero»: los motivos dichos con su número.
    expect(await screen.findByText('Notas: 3 materias bajas en 2.ª Entrega')).toBeInTheDocument()
    expect(screen.getByText('Faltas: 26 en el año (pasó las 25)')).toBeInTheDocument()
  })

  it('las notas salen del último boletín que ya pasó, y el resto con el ciclo elegido', async () => {
    render(<StudentIndicators />)
    await screen.findByText(/2 de 120/)
    expect(callsTo('/admin/student-reports/risk')).toEqual(['/admin/student-reports/risk?periodId=e2&schoolYearId=y26'])
    expect(callsTo('/admin/academic-analytics/dashboard')).toEqual(['/admin/academic-analytics/dashboard?level=EBI&periodId=e2&schoolYearId=y26'])
    expect(screen.getByRole('combobox', { name: 'Boletín' })).toHaveValue('e2')
    // Resumen y la lista de abajo comparten los datos de riesgo: se piden una vez.
    expect(callsTo('/admin/student-reports/risk')).toHaveLength(1)
  })

  it('un boletín de la URL que no es del ciclo no se usa', async () => {
    state.query = 'boletin=otro-ciclo'
    render(<StudentIndicators />)
    await screen.findByText(/2 de 120/)
    expect(callsTo('/admin/student-reports/risk')[0]).toContain('periodId=e2')
  })

  it('adscripción ve sólo lo que sale de los reportes y no pide los indicadores académicos', async () => {
    state.permissions = [REPORTS]
    render(<StudentIndicators />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Resumen', 'Materias y APE', 'Asistencia', 'Quién necesita atención'])
    await screen.findByText(/2 de 120/)
    expect(screen.queryByText('Promoción del último año cerrado')).not.toBeInTheDocument()
    expect(mockedApi.mock.calls.some(([url]) => String(url).startsWith('/admin/academic-analytics'))).toBe(false)
    // Sin la ficha de asistencia, el nombre no es un enlace.
    expect(screen.getByText('Pérez, Ana').closest('a')).toBeNull()
  })

  it('una sección que no puede ver abre el resumen', async () => {
    state.permissions = [REPORTS]
    state.query = 'seccion=trayectoria'
    render(<StudentIndicators />)
    expect(screen.getByRole('tab', { name: 'Resumen' })).toHaveAttribute('aria-selected', 'true')
  })

  it('cambiar de sección deja el boletín y limpia las listas', () => {
    state.query = 'seccion=asistencia&lista=faltas&boletin=e2'
    render(<StudentIndicators />)
    fireEvent.click(screen.getByRole('tab', { name: 'Trayectoria' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/admin/student-indicators?seccion=trayectoria&boletin=e2', { scroll: false })
    fireEvent.keyDown(screen.getByRole('tablist', { name: 'Indicadores de estudiantes' }), { key: 'End' })
    expect(routerMock.replace).toHaveBeenLastCalledWith('/admin/student-indicators?seccion=riesgo&boletin=e2', { scroll: false })
  })

  it('un error se puede reintentar sin perder el resto', async () => {
    let fail = true
    mockedApi.mockImplementation(async (url) => {
      if (pathOf(String(url)) === '/admin/student-reports/risk' && fail) throw new Error('Sin conexión')
      return RESPONSES[pathOf(String(url))] as never
    })
    render(<StudentIndicators />)
    expect(await screen.findByText('90 %')).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo calcular quién necesita atención. Sin conexión')
    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Notas: 3 materias bajas en 2.ª Entrega')).toBeInTheDocument()
  })

  it('«Actualizar» vuelve a pedir todo', async () => {
    render(<StudentIndicators />)
    await screen.findByText(/2 de 120/)
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(callsTo('/admin/student-reports/risk')).toHaveLength(2))
  })
})

describe('las secciones', () => {
  it('Asistencia: por día, con justificadas y llegadas tarde, y la lista que pide el aviso', async () => {
    state.query = 'seccion=asistencia&lista=faltas'
    render(<StudentIndicators />)
    expect(await screen.findByText('8 de 20 días con falta tenían justificativo.')).toBeInTheDocument()
    expect(screen.getByText('En 2 % de los días con lista. Cuentan como que vino.')).toBeInTheDocument()
    expect(await screen.findByText('1 de 120 (0,8 %) estudiantes del ciclo.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '18 y 25 faltas' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Pasó las 25')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Faltas seguidas' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/admin/student-indicators?seccion=asistencia&lista=seguidas', { scroll: false })
  })

  it('Quién necesita atención: filtra por motivo desde la URL', async () => {
    state.query = 'seccion=riesgo&motivo=faltas'
    render(<StudentIndicators />)
    expect(await screen.findByText('Faltas: 26 en el año (pasó las 25)')).toBeInTheDocument()
    expect(screen.queryByText('Notas: 3 materias bajas en 2.ª Entrega')).not.toBeInTheDocument()
    expect(screen.getByText('Mostrando 1 de 1 estudiantes')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Motivo' }), { target: { value: 'notas' } })
    expect(routerMock.replace).toHaveBeenCalledWith('/admin/student-indicators?seccion=riesgo&motivo=notas', { scroll: false })
  })

  it('Rendimiento: notas bajas sobre el total y la comparación con su base', async () => {
    state.query = 'seccion=rendimiento'
    render(<StudentIndicators />)
    expect(await screen.findByText('50 de 200 notas en Insuficiente.')).toBeInTheDocument()
    expect(screen.getByText(/Desde 3 la reunión lo marca en riesgo/)).toBeInTheDocument()
    expect(await screen.findByText('45 de 140 (32,1 %) notas')).toBeInTheDocument()
    const rows = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(rows.indexOf('Matemática')).toBeLessThan(rows.indexOf('Inglés'))
  })

  it('Materias y APE: el ranking del boletín, lo que pasó en la APE y las previas', async () => {
    state.query = 'seccion=materias'
    render(<StudentIndicators />)
    expect(await screen.findByText('12 de 30 (40 %)')).toBeInTheDocument()
    expect(await screen.findByText('Ciclo 2026 todavía no tiene materias que hayan ido a APE: se muestra Ciclo 2025.')).toBeInTheDocument()
    expect(screen.getByText('2 estudiantes empezaron el ciclo debiendo 3 materias.')).toBeInTheDocument()
  })

  it('Trayectoria: el último año cerrado, con egreso sobre el último grado', async () => {
    state.query = 'seccion=trayectoria'
    render(<StudentIndicators />)
    expect(await screen.findByText(/Ciclo 2026 todavía no terminó: se muestra Ciclo 2025/)).toBeInTheDocument()
    expect(screen.getByText('26 de 28 (92,9 %) matriculados en el último grado.')).toBeInTheDocument()
    expect(screen.getByText('Ingreso 2023 (ciclo básico)')).toBeInTheDocument()
  })
})

describe('datos de otro ciclo', () => {
  it('al cambiar de ciclo no se muestran los números del anterior', async () => {
    let resolveOld: (value: unknown) => void = () => undefined
    mockedApi.mockImplementation((url) => {
      const path = pathOf(String(url))
      if (path === '/admin/student-reports/risk' && String(url).includes('y26')) {
        return new Promise((resolve) => {
          resolveOld = resolve
        }) as never
      }
      if (path === '/admin/student-reports/risk') return Promise.resolve({ ...(RESPONSES[path] as object), enrolled: 90 }) as never
      return Promise.resolve(RESPONSES[path]) as never
    })
    const view = render(<StudentIndicators />)
    await waitFor(() => expect(callsTo('/admin/student-reports/risk')).toHaveLength(1))
    state.yearQuery = 'schoolYearId=y25'
    view.rerender(<StudentIndicators />)
    expect(await screen.findByText(/2 de 90/)).toBeInTheDocument()
    await act(async () => resolveOld(RESPONSES['/admin/student-reports/risk']))
    expect(screen.queryByText(/2 de 120/)).not.toBeInTheDocument()
  })
})
