import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserNav from './UserNav'
import { api } from '@/lib/api'

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

describe('UserNav', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    mockUsePathname.mockReset()
    mockUsePathname.mockReturnValue('/dashboard')
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/dashboard' },
    })
  })

  it('shows auth links when there is no session', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('unauthorized'))

    render(<UserNav />)

    await waitFor(() => expect(screen.getByRole('link', { name: 'Iniciar Sesión' })).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /volver/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrarse' })).toBeInTheDocument()
  })

  it('renders fallback role links for approved users when the api does not provide navLinks', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      role: 'TEACHER',
      name: 'Ana',
      email: 'ana@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
    })

    render(<UserNav />)

    expect(await screen.findByText('Mis asistencias')).toBeInTheDocument()
    expect(screen.getByText('Mis eventos')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('uses navLinks from the backend and logs out from the menu', async () => {
    mockUsePathname.mockReturnValue('/login')
    vi.mocked(api)
      .mockResolvedValueOnce({
        role: 'ADMIN',
        email: 'admin@example.com',
        navLinks: [{ href: '/custom', label: 'Custom link' }],
      })
      .mockResolvedValueOnce({})

    render(<UserNav />)

    expect(await screen.findByText('Custom link')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /volver/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /admin@example.com/i }))
    expect(screen.getByRole('link', { name: /configuración del sistema/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/logout', { method: 'POST' })
    )
    expect(window.location.href).toBe('/login')
  })

  it('does not show protected modules for users without access', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      role: 'ADMIN',
      email: 'admin@example.com',
      isApproved: false,
      isActive: true,
      needsProfileCompletion: true,
    })

    render(<UserNav />)

    await screen.findByText('admin@example.com')
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
  })
})
