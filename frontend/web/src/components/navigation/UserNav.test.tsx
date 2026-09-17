import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserNav from './UserNav'
import { AuthProvider } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'

const mockUsePathname = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
}))

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/lib/observability/user-session', () => ({
  identifyObservabilityUser: vi.fn(),
  clearObservabilityUser: vi.fn(),
}))

function renderNav() {
  return render(
    <AuthProvider>
      <UserNav />
    </AuthProvider>,
  )
}

/**
 * Mock de api resuelto por URL (no por orden de llamada). Evita flakiness:
 * el componente dispara /auth/me y /notifications/in-app/unread-count desde
 * efectos independientes, y bajo CI el orden/cantidad puede variar.
 */
function mockApiByUrl(me: Record<string, unknown> | Error, unreadCount = 0) {
  vi.mocked(api).mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.includes('/auth/me')) {
      if (me instanceof Error) throw me
      return me
    }
    if (u.includes('unread-count')) return { count: unreadCount }
    return {}
  })
}

describe('UserNav', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    mockUsePathname.mockReset()
    mockUsePathname.mockReturnValue('/dashboard')
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'http://localhost/dashboard' },
    })
  })

  it('shows auth links when there is no session on a public path', async () => {
    mockUsePathname.mockReturnValue('/login')
    mockApiByUrl(new Error('unauthorized'))

    renderNav()

    await waitFor(() => expect(screen.getByRole('link', { name: 'Iniciar Sesión' })).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /volver/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrarse' })).toBeInTheDocument()
  })

  it('hides the public header on a protected path while the guard redirects', async () => {
    mockUsePathname.mockReturnValue('/admin/attendance')
    mockApiByUrl(new Error('unauthorized'))

    render(
      <AuthProvider>
        <UserNav>
          <div>placeholder del guard</div>
        </UserNav>
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByText('placeholder del guard')).toBeInTheDocument())

    expect(screen.queryByRole('link', { name: 'Iniciar Sesión' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Registrarse' })).not.toBeInTheDocument()
  })

  it('no muestra barra de módulos; campana y menú de usuario para docente aprobado', async () => {
    mockApiByUrl({
      role: 'TEACHER',
      name: 'Ana',
      email: 'ana@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
    })

    renderNav()

    expect(await screen.findByText('A')).toBeInTheDocument()
    expect(screen.queryByText('Mis asistencias')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /avisos/i })).toBeInTheDocument()
  })

  it('admin puede abrir menú y cerrar sesión', async () => {
    mockUsePathname.mockReturnValue('/login')
    mockApiByUrl({
      role: 'ADMIN',
      email: 'admin@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
      permissions: [{ id: 'settings.manage', scope: 'all' }],
    })

    renderNav()

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /volver/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /admin@example.com/i }))
    const menuLinks = screen.getAllByRole('link')
    expect(menuLinks.map((link) => link.textContent?.trim()).slice(-2)).toEqual(['Mi perfil', 'Configuración del sistema'])
    expect(screen.getByRole('link', { name: /configuración del sistema/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }))

    await waitFor(() => expect(globalThis.location.href).toContain('/auth/logout'))
  })

  it('does not show protected modules for users without access', async () => {
    mockApiByUrl({
      role: 'ADMIN',
      email: 'admin@example.com',
      isApproved: false,
      isActive: true,
      needsProfileCompletion: true,
    })

    renderNav()

    await screen.findByText('admin@example.com')
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
  })

  it('admin con permisos globales no ve atajos "Mis…" de otros roles en el menú lateral', async () => {
    mockUsePathname.mockReturnValue('/admin/licenses')
    mockApiByUrl({
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

    renderNav()

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
    mockApiByUrl({
      role: 'STAFF',
      email: 'staff@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
      permissions: [{ id: 'users.read', scope: 'all' }],
    })

    renderNav()

    expect((await screen.findAllByText('staff@example.com')).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cursos' })).not.toBeInTheDocument()
  })
})
