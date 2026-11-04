import { fireEvent, render, screen } from '@testing-library/react'
import StudentAttendanceTabs from './StudentAttendanceTabs'

const { routerMock, state } = vi.hoisted(() => ({
  routerMock: { replace: vi.fn(), push: vi.fn() },
  state: { query: '', permissions: [] as { id: string; scope: 'own' | 'all' }[] },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/admin/student-attendance',
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => ({ me: { id: 'u1', permissions: state.permissions } }) }))
vi.mock('./JustificationRangesPanel', () => ({ default: () => <p>panel justificaciones</p> }))
vi.mock('./StudentAttendanceWorkspace', () => ({ default: () => <p>fichas por estudiante</p> }))
vi.mock('./PendingRollCallsPanel', () => ({ default: () => <p>panel listas sin pasar</p> }))

const READ = { id: 'student-attendance.read', scope: 'all' as const }
const REPORTS = { id: 'student-reports.read', scope: 'all' as const }
const ADSCRIPCION = [READ, REPORTS, { id: 'student-attendance.justify', scope: 'all' as const }]

beforeEach(() => { state.query = ''; state.permissions = [...ADSCRIPCION, { id: 'student-attendance.manage', scope: 'all' }] })

describe('asistencia centrada en el estudiante', () => {
  it('abre por estudiante y separa los indicadores del trabajo diario', () => {
    render(<StudentAttendanceTabs />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Por estudiante', 'Carga rápida', 'Listas sin pasar'])
    expect(screen.getByText('fichas por estudiante')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver indicadores/ })).toHaveAttribute('href', '/admin/student-indicators?seccion=asistencia')
  })
  it('adscripción puede cargar licencias y no ve el control de listas', () => {
    state.permissions = ADSCRIPCION
    state.query = 'tab=justificaciones'
    render(<StudentAttendanceTabs />)
    expect(screen.queryByRole('tab', { name: 'Listas sin pasar' })).not.toBeInTheDocument()
    expect(screen.getByText('panel justificaciones')).toBeInTheDocument()
  })
  it('un perfil de consulta sólo ve fichas y oculta las cargas', () => {
    state.permissions = [READ]
    render(<StudentAttendanceTabs />)
    expect(screen.getByText('fichas por estudiante')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /indicadores/ })).not.toBeInTheDocument()
  })
  it('una pestaña sin permiso vuelve a las fichas', () => {
    state.permissions = ADSCRIPCION
    state.query = 'tab=pendientes'
    render(<StudentAttendanceTabs />)
    expect(screen.getByText('fichas por estudiante')).toBeInTheDocument()
  })
  it('cambiar pestaña limpia al estudiante y conserva los demás parámetros', () => {
    state.query = 'studentId=s1&action=justificar&schoolYearId=sy1'
    render(<StudentAttendanceTabs />)
    fireEvent.click(screen.getByRole('tab', { name: 'Carga rápida' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/admin/student-attendance?schoolYearId=sy1&tab=justificaciones', { scroll: false })
  })
  it.each(['seguidas', 'faltas'])('los avisos guardados de %s se abren en la lista de Indicadores de estudiantes', (tab) => {
    state.query = `tab=${tab}&schoolYearId=sy1`
    render(<StudentAttendanceTabs />)
    expect(routerMock.replace).toHaveBeenCalledWith(`/admin/student-indicators?seccion=asistencia&lista=${tab}&schoolYearId=sy1`)
    expect(screen.queryByText('fichas por estudiante')).not.toBeInTheDocument()
  })
  it('un perfil con reportes sin lectura de fichas se deriva a los indicadores de asistencia', () => {
    state.permissions = [REPORTS]
    render(<StudentAttendanceTabs />)
    expect(routerMock.replace).toHaveBeenCalledWith('/admin/student-indicators?seccion=asistencia')
  })
})
