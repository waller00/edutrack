import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './page'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

describe('Home page', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/' },
    })
  })

  it('redirects unauthenticated users to login', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('unauthorized'))

    const { container } = render(<Home />)

    await waitFor(() => expect(window.location.href).toBe('/login'))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders admin sections and resends verification emails', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        name: 'Ada',
        email: 'ada@example.com',
        role: 'ADMIN',
        emailVerifiedAt: null,
        isApproved: true,
        isActive: true,
      })
      .mockResolvedValueOnce({})

    render(<Home />)

    expect(await screen.findByText('Gestión de usuarios')).toBeInTheDocument()
    expect(screen.getByText('Gestión de eventos y notificaciones')).toBeInTheDocument()
    expect(screen.getByText('Analíticas')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /reenviar correo/i }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/verify/resend', { method: 'POST' })
    )
    expect(screen.getByRole('button', { name: /enviado/i })).toBeDisabled()
  })

  it('shows the profile completion state instead of role sections', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      name: 'Eva',
      email: 'eva@example.com',
      role: 'STAFF',
      emailVerifiedAt: '2026-01-01',
      needsProfileCompletion: true,
      isApproved: true,
      isActive: true,
    })

    render(<Home />)

    expect(await screen.findByText('Perfil incompleto')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /completar perfil/i })).toHaveAttribute('href', '/onboarding')
    expect(screen.queryByText('Mis asistencias')).not.toBeInTheDocument()
  })

  it('shows approval and inactive alerts when access is restricted', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      name: 'Luis',
      email: 'luis@example.com',
      role: 'TEACHER',
      emailVerifiedAt: '2026-01-01',
      isApproved: false,
      isActive: false,
    })

    render(<Home />)

    expect(await screen.findByText('Cuenta pendiente de aprobación')).toBeInTheDocument()
    expect(screen.getByText('Cuenta dada de baja')).toBeInTheDocument()
    expect(screen.getByText('Tu cuenta está desactivada y no puede usar módulos operativos.')).toBeInTheDocument()
    expect(screen.queryByText('Ver asistencias')).not.toBeInTheDocument()
  })
})
