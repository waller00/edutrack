import { fireEvent, render, screen, within } from '@testing-library/react'
import GuidePage from './GuidePage'
import OnboardingCompanion from './OnboardingCompanion'
import { useAuth, useOptionalAuth, type AuthMe } from '@/contexts/AuthContext'
import { onboardingStorageKey } from '@/lib/navigation/onboarding'

const navigation = vi.hoisted(() => ({ pathname: '/guia', push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigation.push }), usePathname: () => navigation.pathname }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(), useOptionalAuth: vi.fn() }))

function signedIn(me: AuthMe) {
  const value = { me, loading: false, error: false, refresh: async () => {} }
  vi.mocked(useAuth).mockReturnValue(value)
  vi.mocked(useOptionalAuth).mockReturnValue(value)
}

const staff: AuthMe = { id: 'staff-guide', role: 'STAFF', permissions: [
  { id: 'attendance.read', scope: 'own' }, { id: 'licenses.read', scope: 'own' },
] }

describe('guía práctica', () => {
  beforeEach(() => {
    localStorage.clear()
    navigation.pathname = '/guia'
    signedIn(staff)
  })

  it('muestra los pasos propios y permite elegir la pantalla que se quiere conocer', () => {
    render(<GuidePage />)
    expect(screen.getByRole('heading', { name: 'Guía' })).toBeInTheDocument()
    const steps = screen.getByRole('navigation', { name: 'Pasos de tu guía' })
    expect(within(steps).queryByRole('button', { name: /Libretas/ })).not.toBeInTheDocument()
    expect(within(steps).queryByRole('button', { name: /Asistencia del personal/ })).not.toBeInTheDocument()
    fireEvent.click(within(steps).getByRole('button', { name: /Mis asistencias/ }))
    expect(screen.getByRole('heading', { name: 'Consultá tus entradas y salidas' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Empezar recorrido' }))
    expect(navigation.push).toHaveBeenCalledWith('/me/attendance')
    expect(JSON.parse(localStorage.getItem(onboardingStorageKey(staff)!)!).completed).toEqual([])
  })

  it('acompaña dentro de las pantallas, persiste avance, permite pausar y terminar', () => {
    const { rerender, unmount } = render(<><GuidePage /><OnboardingCompanion /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Empezar recorrido' }))
    expect(navigation.push).toHaveBeenLastCalledWith('/profile')

    navigation.pathname = '/me/attendance'
    rerender(<OnboardingCompanion />)
    expect(screen.queryByRole('button', { name: /Ya lo hice/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a Mi perfil' })).toBeInTheDocument()

    navigation.pathname = '/profile'
    rerender(<OnboardingCompanion />)
    fireEvent.click(screen.getByRole('button', { name: /Ya lo hice/ }))
    expect(navigation.push).toHaveBeenLastCalledWith('/me/attendance')
    expect(screen.getByText('1 de 3 completados')).toBeInTheDocument()
    unmount()

    navigation.pathname = '/me/attendance'
    const companion = render(<OnboardingCompanion />)
    fireEvent.click(screen.getByRole('button', { name: 'Continuar más tarde' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    companion.unmount()

    navigation.pathname = '/guia'
    const guide = render(<GuidePage />)
    expect(screen.getByText('1 de 3 pasos completados')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Consultá tus entradas y salidas' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir este paso' }))
    guide.unmount()

    navigation.pathname = '/me/attendance'
    const resumed = render(<OnboardingCompanion />)
    fireEvent.click(screen.getByRole('button', { name: /Ya lo hice/ }))
    expect(navigation.push).toHaveBeenLastCalledWith('/me/licenses')
    navigation.pathname = '/me/licenses'
    resumed.rerender(<OnboardingCompanion />)
    fireEvent.click(screen.getByRole('button', { name: /Finalizar recorrido/ }))
    expect(navigation.push).toHaveBeenLastCalledWith('/guia')
    resumed.unmount()

    navigation.pathname = '/guia'
    render(<GuidePage />)
    expect(screen.getByRole('heading', { name: '¡Terminaste tu recorrido!' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar recorrido' }))
    expect(screen.getByText('0 de 3 pasos completados')).toBeInTheDocument()
  })

  it('al cambiar de cuenta o de permisos no conserva pasos completados ajenos', () => {
    localStorage.setItem(onboardingStorageKey(staff)!, JSON.stringify({ started: true, completed: ['profile'] }))
    const { rerender } = render(<GuidePage />)
    expect(screen.getByText('1 de 3 pasos completados')).toBeInTheDocument()
    signedIn({ ...staff, id: 'another-user' })
    rerender(<GuidePage />)
    expect(screen.getByText('0 de 3 pasos completados')).toBeInTheDocument()
    signedIn({ ...staff, permissions: [{ id: 'attendance.read', scope: 'all' }] })
    rerender(<GuidePage />)
    expect(screen.getByRole('button', { name: /Asistencia del personal/ })).toBeInTheDocument()
    expect(screen.getByText('0 de 3 pasos completados')).toBeInTheDocument()
  })

  it('recupera un progreso corrupto sin bloquear el recorrido', () => {
    localStorage.setItem(onboardingStorageKey(staff)!, '{invalid')
    render(<GuidePage />)
    expect(screen.getByText('0 de 3 pasos completados')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Empezar recorrido' }))
    expect(navigation.push).toHaveBeenCalledWith('/profile')
  })
})
