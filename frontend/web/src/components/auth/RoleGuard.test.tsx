import { render, screen, waitFor } from '@testing-library/react'
import RoleGuard from '@/components/auth/RoleGuard'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
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

describe('RoleGuard', () => {
  beforeEach(() => {
    mockLocation()
  })

  it('renders children for an allowed, active and approved user', async () => {
    mockedApi.mockResolvedValueOnce({
      role: 'TEACHER',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: false,
    } as never)

    render(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    expect(await screen.findByText('contenido protegido')).toBeInTheDocument()
    expect(window.location.href).toBe('')
  })

  it('redirects to login when me is null', async () => {
    mockedApi.mockResolvedValueOnce(null as never)

    render(
      <RoleGuard allow={['ADMIN']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    await waitFor(() => expect(window.location.href).toBe('/login'))
  })

  it('redirects to login when auth lookup fails', async () => {
    mockedApi.mockRejectedValueOnce(new Error('401'))

    render(
      <RoleGuard allow={['ADMIN']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    await waitFor(() => expect(window.location.href).toBe('/login'))
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument()
  })

  it('redirects to onboarding when profile completion is pending', async () => {
    mockedApi.mockResolvedValueOnce({
      role: 'TEACHER',
      isActive: true,
      isApproved: true,
      needsProfileCompletion: true,
    } as never)

    render(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )

    await waitFor(() => expect(window.location.href).toBe('/onboarding'))
  })

  it('redirects home when the user is inactive, not approved or has a forbidden role', async () => {
    mockedApi
      .mockResolvedValueOnce({
        role: 'TEACHER',
        isActive: false,
        isApproved: true,
        needsProfileCompletion: false,
      } as never)
      .mockResolvedValueOnce({
        role: 'TEACHER',
        isActive: true,
        isApproved: false,
        needsProfileCompletion: false,
      } as never)
      .mockResolvedValueOnce({
        role: 'STAFF',
        isActive: true,
        isApproved: true,
        needsProfileCompletion: false,
      } as never)

    const { rerender } = render(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )
    await waitFor(() => expect(window.location.href).toBe('/'))

    window.location.href = ''
    rerender(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )
    await waitFor(() => expect(window.location.href).toBe('/'))

    window.location.href = ''
    rerender(
      <RoleGuard allow={['TEACHER']}>
        <div>contenido protegido</div>
      </RoleGuard>,
    )
    await waitFor(() => expect(window.location.href).toBe('/'))
  })
})
