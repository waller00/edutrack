import { render, screen, waitFor } from '@testing-library/react'
import AuthGuard from '@/components/auth/AuthGuard'
import { AuthProvider } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/attendance',
}))

vi.mock('@/lib/observability/user-session', () => ({
  identifyObservabilityUser: vi.fn(),
  clearObservabilityUser: vi.fn(),
}))

const mockedApi = vi.mocked(api)

function mockLocation() {
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
}

/** Marca si el subárbol llegó a montarse (los efectos hijos disparan fetches a la API). */
const childMounted = vi.fn()

function Child() {
  childMounted()
  return <div>contenido protegido</div>
}

function renderGuarded() {
  return render(
    <AuthProvider>
      <AuthGuard>
        <Child />
      </AuthGuard>
    </AuthProvider>,
  )
}

describe('AuthGuard', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    childMounted.mockReset()
    mockLocation()
  })

  it('renders children for an active and approved user', async () => {
    mockedApi.mockResolvedValue({
      role: 'ADMIN',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: false,
    } as never)

    renderGuarded()

    expect(await screen.findByText('contenido protegido')).toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('never mounts children and redirects to login preserving the path when there is no session', async () => {
    mockedApi.mockRejectedValue(new Error('401'))

    renderGuarded()

    await waitFor(() => expect(window.location.href).toBe('/login?returnTo=%2Fadmin%2Fattendance'))
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument()
    expect(childMounted).not.toHaveBeenCalled()
  })

  it('shows the loading placeholder instead of children while the session resolves', () => {
    mockedApi.mockReturnValue(new Promise(() => {}) as never)

    renderGuarded()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(childMounted).not.toHaveBeenCalled()
  })

  it('redirects to onboarding when profile completion is pending', async () => {
    mockedApi.mockResolvedValue({
      role: 'ADMIN',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: true,
    } as never)

    renderGuarded()

    await waitFor(() => expect(window.location.href).toBe('/onboarding'))
    expect(childMounted).not.toHaveBeenCalled()
  })

  it('redirects home when the user is not approved', async () => {
    mockedApi.mockResolvedValue({
      role: 'ADMIN',
      isActive: true,
      isApproved: false,
      needsProfileCompletion: false,
    } as never)

    renderGuarded()

    await waitFor(() => expect(window.location.href).toBe('/'))
    expect(childMounted).not.toHaveBeenCalled()
  })
})
