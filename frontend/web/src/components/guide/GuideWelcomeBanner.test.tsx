import { fireEvent, render, screen } from '@testing-library/react'
import GuideWelcomeBanner from './GuideWelcomeBanner'
import { useAuth, type AuthMe } from '@/contexts/AuthContext'
import { onboardingStorageKey } from '@/lib/navigation/onboarding'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }))

function signedIn(id = 'banner-user') {
  const me: AuthMe = { id, role: 'STAFF', permissions: [{ id: 'attendance.read', scope: 'own' }] }
  vi.mocked(useAuth).mockReturnValue({ me, loading: false, error: false, refresh: async () => {} })
  return me
}

describe('invitación al onboarding', () => {
  beforeEach(() => {
    localStorage.clear()
    signedIn()
  })

  it('se puede ocultar por cuenta y sigue disponible para otra persona', () => {
    const { unmount } = render(<GuideWelcomeBanner />)
    expect(screen.getByRole('link', { name: 'Empezar onboarding' })).toHaveAttribute('href', '/guia')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar invitación al onboarding' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    unmount()
    const hidden = render(<GuideWelcomeBanner />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    signedIn('someone-else')
    hidden.rerender(<GuideWelcomeBanner />)
    expect(screen.getByRole('link', { name: 'Empezar onboarding' })).toBeInTheDocument()
  })

  it('ofrece retomar el avance y desaparece al terminar todos los pasos', () => {
    const me = signedIn()
    localStorage.setItem(onboardingStorageKey(me)!, JSON.stringify({ started: true, completed: ['profile'] }))
    const { unmount } = render(<GuideWelcomeBanner />)
    expect(screen.getByRole('link', { name: 'Continuar onboarding' })).toBeInTheDocument()
    expect(screen.getByText(/1 de 2 pasos completados/)).toBeInTheDocument()
    unmount()
    localStorage.setItem(onboardingStorageKey(me)!, JSON.stringify({ started: true, completed: ['profile', 'my-attendance'] }))
    render(<GuideWelcomeBanner />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('continúa funcionando cuando el navegador bloquea el almacenamiento', () => {
    signedIn('blocked-storage')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
    render(<GuideWelcomeBanner />)
    expect(screen.getByRole('link', { name: 'Empezar onboarding' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar invitación al onboarding' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})
