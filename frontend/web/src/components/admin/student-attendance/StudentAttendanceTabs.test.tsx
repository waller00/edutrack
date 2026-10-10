import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentAttendanceTabs from './StudentAttendanceTabs'
import { legacyReportsTarget } from '@/lib/admin/legacy-reports'

const { routerMock, state } = vi.hoisted(() => ({
  routerMock: { replace: vi.fn(), push: vi.fn() },
  state: { tab: null as string | null, permissions: [] as { id: string; scope: 'own' | 'all' }[] },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/admin/student-attendance',
  useSearchParams: () => ({ get: (key: string) => (key === 'tab' ? state.tab : null) }),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ me: { id: 'u1', permissions: state.permissions } }),
}))
// Cada pestaña se reemplaza por su nombre: acá importa cuál se muestra, no su contenido.
vi.mock('./JustificationRangesPanel', () => ({ default: () => <p>panel justificaciones</p> }))
vi.mock('./PendingRollCallsPanel', () => ({ default: () => <p>panel listas sin pasar</p> }))
vi.mock('@/components/admin/student-reports/ReportTabs', () => ({
  StreaksTab: () => <p>panel faltas seguidas</p>,
  ThresholdsTab: () => <p>panel 18 y 25 faltas</p>,
}))

const ADSCRIPCION = [
  { id: 'student-attendance.justify', scope: 'all' as const },
  { id: 'student-reports.read', scope: 'all' as const },
]
const ADMINISTRACION = [...ADSCRIPCION, { id: 'student-attendance.manage', scope: 'all' as const }]

beforeEach(() => {
  vi.clearAllMocks()
  state.tab = null
  state.permissions = ADMINISTRACION
})

describe('<StudentAttendanceTabs />', () => {
  it('administración ve las cuatro pestañas y arranca en justificaciones', () => {
    render(<StudentAttendanceTabs />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Justificaciones',
      'Faltas seguidas',
      '18 y 25 faltas',
      'Listas sin pasar',
    ])
    expect(screen.getByText('panel justificaciones')).toBeInTheDocument()
  })

  it('adscripción no ve las listas sin pasar', () => {
    state.permissions = ADSCRIPCION
    render(<StudentAttendanceTabs />)
    expect(screen.queryByRole('tab', { name: 'Listas sin pasar' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('el aviso de 18 faltas abre directo en esa pestaña', () => {
    state.tab = 'faltas'
    render(<StudentAttendanceTabs />)
    expect(screen.getByRole('tab', { name: '18 y 25 faltas' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('panel 18 y 25 faltas')).toBeInTheDocument()
  })

  it('una pestaña no permitida abre la primera que sí', () => {
    state.permissions = ADSCRIPCION
    state.tab = 'pendientes'
    render(<StudentAttendanceTabs />)
    expect(screen.getByText('panel justificaciones')).toBeInTheDocument()
  })

  it('cambiar de pestaña la deja en la URL', () => {
    render(<StudentAttendanceTabs />)
    fireEvent.click(screen.getByRole('tab', { name: 'Faltas seguidas' }))
    expect(routerMock.replace).toHaveBeenCalledWith('/admin/student-attendance?tab=seguidas', { scroll: false })
  })

  it('con un solo permiso no muestra pestañas, sólo el contenido', () => {
    state.permissions = [{ id: 'student-attendance.justify', scope: 'all' }]
    render(<StudentAttendanceTabs />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('panel justificaciones')).toBeInTheDocument()
  })
})

describe('enlaces viejos a Reportes', () => {
  it('cada pestaña vieja va a su lugar nuevo', () => {
    expect(legacyReportsTarget('faltas')).toBe('/admin/student-attendance?tab=faltas')
    expect(legacyReportsTarget('seguidas')).toBe('/admin/student-attendance?tab=seguidas')
    expect(legacyReportsTarget('alertas')).toBe('/admin/student-attendance?tab=seguidas')
    expect(legacyReportsTarget(null)).toBe('/admin/student-attendance?tab=seguidas')
    expect(legacyReportsTarget('notas')).toBe('/libreta/indicadores?view=seguimiento')
    expect(legacyReportsTarget('bajas')).toBe('/libreta/indicadores?view=seguimiento')
  })
})
