import { render, screen, within } from '@testing-library/react'
import GuidePage from '@/components/guide/GuidePage'
import { useAuth, useOptionalAuth } from '@/contexts/AuthContext'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(), useOptionalAuth: vi.fn() }))

function signedIn(permissions: Array<{ id: string; scope: 'own' | 'all' }>) {
  const value = { me: { role: 'X', permissions }, loading: false, error: false, refresh: async () => {} }
  vi.mocked(useAuth).mockReturnValue(value)
  vi.mocked(useOptionalAuth).mockReturnValue(value)
}

describe('GuidePage', () => {
  it('explica que hay dos asistencias distintas, con enlaces sólo a lo que se puede abrir', () => {
    signedIn([
      { id: 'attendance.read', scope: 'own' },
      { id: 'student-attendance.take', scope: 'own' },
    ])
    render(<GuidePage />)

    const box = screen.getByRole('region', { name: 'Dos asistencias distintas' })
    expect(within(box).getByRole('heading', { name: 'Del personal' })).toBeInTheDocument()
    expect(within(box).getByRole('heading', { name: 'De los estudiantes' })).toBeInTheDocument()
    // Lo suyo, con enlace; lo institucional sólo nombrado.
    expect(within(box).getByRole('link', { name: 'Mis asistencias' })).toHaveAttribute('href', '/me/attendance')
    expect(within(box).getByRole('link', { name: 'Pase de lista' })).toHaveAttribute('href', '/me/roll-call')
    expect(within(box).queryByRole('link', { name: 'Asistencia del personal' })).not.toBeInTheDocument()
    expect(within(box).getByText('Asistencia del personal')).toBeInTheDocument()
  })

  it('lista los grupos del menú con lo que la persona puede usar y para qué sirve', () => {
    signedIn([
      { id: 'attendance.read', scope: 'own' },
      { id: 'student-attendance.take', scope: 'own' },
    ])
    render(<GuidePage />)

    const mine = screen.getByRole('region', { name: 'Mi trabajo' })
    expect(within(mine).getByRole('link', { name: /Pase de lista/ })).toHaveTextContent(
      'Marcá qué estudiantes vinieron a cada una de tus clases.',
    )
    expect(screen.queryByRole('region', { name: 'Personal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Estudiantes' })).not.toBeInTheDocument()
  })
})
