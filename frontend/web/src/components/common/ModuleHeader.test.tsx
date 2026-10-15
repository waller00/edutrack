import { render, screen } from '@testing-library/react'
import ModuleHeader from '@/components/common/ModuleHeader'
import { useOptionalAuth } from '@/contexts/AuthContext'

vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: vi.fn() }))

const mockedAuth = vi.mocked(useOptionalAuth)

function signedIn(permissions: Array<{ id: string; scope: 'own' | 'all' }>) {
  mockedAuth.mockReturnValue({
    me: { role: 'ADMIN', permissions },
    loading: false,
    error: false,
    refresh: async () => {},
  })
}

describe('ModuleHeader', () => {
  it('dice de qué parte es, cómo se llama y para qué sirve', () => {
    signedIn([{ id: 'attendance.read', scope: 'all' }])
    render(<ModuleHeader id="staff-attendance" actions={<button type="button">Exportar</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Asistencia del personal' })).toBeInTheDocument()
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.getByText(/docentes y funcionarios/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument()
  })

  it('ofrece la sección con la que se confunde sólo si se puede abrir', () => {
    signedIn([
      { id: 'attendance.read', scope: 'all' },
      { id: 'student-attendance.justify', scope: 'all' },
    ])
    render(<ModuleHeader id="staff-attendance" />)
    expect(screen.getByText('¿Buscás las faltas de los estudiantes?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Asistencia de estudiantes' })).toHaveAttribute(
      'href',
      '/admin/student-attendance',
    )
    // Licencias no: este usuario no las puede abrir.
    expect(screen.queryByRole('link', { name: 'Licencias' })).not.toBeInTheDocument()
  })

  it('sin sesión no ofrece enlaces cruzados', () => {
    mockedAuth.mockReturnValue(null)
    render(<ModuleHeader id="student-attendance" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Asistencia de estudiantes' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Secciones relacionadas' })).not.toBeInTheDocument()
  })

  it('en Inicio no muestra el grupo', () => {
    mockedAuth.mockReturnValue(null)
    render(<ModuleHeader id="guide" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Guía' })).toBeInTheDocument()
    expect(screen.queryByText('Inicio')).not.toBeInTheDocument()
  })
})
