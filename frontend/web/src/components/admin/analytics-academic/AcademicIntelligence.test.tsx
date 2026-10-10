import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicIntelligence from './AcademicIntelligence'

const { state } = vi.hoisted(() => ({
  state: { view: null as string | null, permissions: [] as { id: string; scope: 'own' | 'all' }[] },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'view' ? state.view : null) }),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ me: { id: 'u1', permissions: state.permissions } }),
}))
vi.mock('@/components/admin/student-reports/GradeFollowUp', () => ({ default: () => <p>seguimiento de notas</p> }))
// El tablero real pide datos: acá sólo importa con qué opciones se arma.
vi.mock('./AcademicDashboard', async () => {
  const actual = await vi.importActual<typeof import('./AcademicDashboard')>('./AcademicDashboard')
  return {
    ...actual,
    default: ({ followUp, initialView }: { followUp?: boolean; initialView?: string }) => (
      <p>
        tablero followUp={String(Boolean(followUp))} vista={initialView ?? 'resumen'}
      </p>
    ),
  }
})

const ANALYTICS = { id: 'academic-analytics.read', scope: 'all' as const }
const REPORTS = { id: 'student-reports.read', scope: 'all' as const }

beforeEach(() => {
  state.view = null
  state.permissions = []
})

describe('<AcademicIntelligence />', () => {
  it('dirección (indicadores y reportes): el tablero con la vista Seguimiento', () => {
    state.permissions = [ANALYTICS, REPORTS]
    render(<AcademicIntelligence />)
    expect(screen.getByText('tablero followUp=true vista=resumen')).toBeInTheDocument()
  })

  it('?view=seguimiento abre directo en el seguimiento', () => {
    state.permissions = [ANALYTICS, REPORTS]
    state.view = 'seguimiento'
    render(<AcademicIntelligence />)
    expect(screen.getByText('tablero followUp=true vista=followup')).toBeInTheDocument()
  })

  it('adscripción (sólo reportes): sólo el seguimiento de notas', () => {
    state.permissions = [REPORTS]
    render(<AcademicIntelligence />)
    expect(screen.getByText('seguimiento de notas')).toBeInTheDocument()
    expect(screen.queryByText(/tablero/)).not.toBeInTheDocument()
  })

  it('inspección (sólo indicadores): el tablero sin seguimiento, aunque lo pida la URL', () => {
    state.permissions = [ANALYTICS]
    state.view = 'seguimiento'
    render(<AcademicIntelligence />)
    expect(screen.getByText('tablero followUp=false vista=resumen')).toBeInTheDocument()
  })
})
