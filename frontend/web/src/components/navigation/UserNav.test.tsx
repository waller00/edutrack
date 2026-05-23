import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserNav from './UserNav'
import { api } from '@/lib/api/client'

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('@/lib/api/client', () => ({
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

  it('no muestra barra de módulos; campana y menú de usuario para docente aprobado', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        role: 'TEACHER',
        name: 'Ana',
        email: 'ana@example.com',
        isApproved: true,
        isActive: true,
        needsProfileCompletion: false,
      })
      .mockResolvedValueOnce({ count: 0 })

    render(<UserNav />)

    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(screen.queryByText('Mis asistencias')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /avisos/i })).toBeInTheDocument()
  })

  it('admin puede abrir menú y cerrar sesión', async () => {
    mockUsePathname.mockReturnValue('/login')
    vi.mocked(api)
      .mockResolvedValueOnce({
        role: 'ADMIN',
        email: 'admin@example.com',
        isApproved: true,
        isActive: true,
        needsProfileCompletion: false,
        permissions: [{ id: 'settings.manage', scope: 'all' }],
      })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({})

    render(<UserNav />)

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /volver/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /admin@example.com/i }))
    const menuLinks = screen.getAllByRole('link')
    expect(menuLinks.map((link) => link.textContent?.trim()).slice(-2)).toEqual(['Mi perfil', 'Configuración del sistema'])
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

  it('admin con permisos globales no ve atajos "Mis…" de otros roles en el menú lateral', async () => {
    mockUsePathname.mockReturnValue('/admin/licenses')
    vi.mocked(api)
      .mockResolvedValueOnce({
        role: 'ADMIN',
        name: 'Admin',
        email: 'admin@example.com',
        isApproved: true,
        isActive: true,
        needsProfileCompletion: false,
        permissions: [
          { id: 'attendance.read', scope: 'all' },
          { id: 'events.read', scope: 'all' },
          { id: 'licenses.read', scope: 'all' },
          { id: 'users.read', scope: 'all' },
        ],
      })
      .mockResolvedValueOnce({ count: 0 })

    render(<UserNav />)

    await screen.findByRole('link', { name: 'Licencias' })
    expect(screen.queryByRole('link', { name: 'Mis licencias' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mis asistencias' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mis eventos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Eventos asignados' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Asistencias' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Asistencias' })).toHaveAttribute('href', '/admin/attendance')
  })

  it('muestra módulos por permiso aunque el rol no sea ADMIN', async () => {
    mockUsePathname.mockReturnValue('/admin/users')
    vi.mocked(api)
      .mockResolvedValueOnce({
        role: 'STAFF',
        email: 'staff@example.com',
        isApproved: true,
        isActive: true,
        needsProfileCompletion: false,
        permissions: [{ id: 'users.read', scope: 'all' }],
      })
      .mockResolvedValueOnce({ count: 0 })

    render(<UserNav />)

    expect((await screen.findAllByText('staff@example.com')).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cursos' })).not.toBeInTheDocument()
  })
})
