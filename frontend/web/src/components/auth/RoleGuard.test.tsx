import { render, screen, waitFor } from '@testing-library/react'
import RoleGuard from '@/components/auth/RoleGuard'
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
  const location = {
    href: '',
  }
  Object.defineProperty(window, 'location', {
    value: location,
    writable: true,
  })
  return location
}

function renderGuarded(ui: React.ReactNode) {
  return render(<AuthProvider>{ui}</AuthProvider>)
}

describe('RoleGuard', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockLocation()
  })

  it('renders children for an allowed, active and approved user', async () => {
    mockedApi.mockResolvedValue({
      role: 'TEACHER',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: false,
    } as never)

    renderGuarded(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    expect(await screen.findByText('contenido protegido')).toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('redirects to login preserving the current path when me is null', async () => {
    mockedApi.mockResolvedValue(null as never)

    renderGuarded(
      <RoleGuard allow={['ADMIN']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    await waitFor(() => expect(window.location.href).toBe('/login?returnTo=%2Fadmin%2Fattendance'))
  })

  it('redirects to login when auth lookup fails', async () => {
    mockedApi.mockRejectedValue(new Error('401'))

    renderGuarded(
      <RoleGuard allow={['ADMIN']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    await waitFor(() => expect(window.location.href).toBe('/login?returnTo=%2Fadmin%2Fattendance'))
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument()
  })

  it('redirects to onboarding when profile completion is pending', async () => {
    mockedApi.mockResolvedValue({
      role: 'TEACHER',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: true,
    } as never)

    renderGuarded(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    await waitFor(() => expect(window.location.href).toBe('/onboarding'))
  })

  it('redirects home when the user is inactive', async () => {
    mockedApi.mockResolvedValue({
      role: 'TEACHER',
      isActive: false,
      isApproved: true,
      needsProfileCompletion: false,
    } as never)

    const { unmount } = renderGuarded(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )
    await waitFor(() => expect(window.location.href).toBe('/'))
    unmount()
  })

  it('redirects home when the user is not approved', async () => {
    mockedApi.mockResolvedValue({
      role: 'TEACHER',
      isActive: true,
      isApproved: false,
      needsProfileCompletion: false,
    } as never)

    const { unmount } = renderGuarded(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )
    await waitFor(() => expect(window.location.href).toBe('/'))
    unmount()
  })

  it('redirects home when the role is forbidden', async () => {
    mockedApi.mockResolvedValue({
      role: 'STAFF',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: false,
    } as never)

    renderGuarded(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )
    await waitFor(() => expect(window.location.href).toBe('/'))
  })

  it('allows access by permission+scope even if the role is not in allow', async () => {
    mockedApi.mockResolvedValue({
      role: 'COORDINADOR',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: false,
      permissions: [{ id: 'attendance.read', scope: 'all' }],
    } as never)

    renderGuarded(
      <RoleGuard permission="attendance.read" permissionScope="all">
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    expect(await screen.findByText('contenido protegido')).toBeInTheDocument()
    expect(window.location.href).toBe('')
  })
})
