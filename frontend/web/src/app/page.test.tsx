import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
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
      .mockResolvedValueOnce({ total: 0, data: [] })
      .mockResolvedValueOnce({ total: 0, data: [] })
      .mockResolvedValueOnce({})

    render(<Home />)

    expect(await screen.findByText('Cronología operativa')).toBeInTheDocument()
    expect(screen.getByText('Asistencias')).toBeInTheDocument()
    expect(screen.getByText('Eventos')).toBeInTheDocument()
    expect(await screen.findByText(/No hay actividad reciente ni eventos próximos/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /reenviar correo/i }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/verify/resend', { method: 'POST' })
    )
    expect(screen.getByRole('button', { name: /enviado/i })).toBeDisabled()
  })

  it('combina evento en curso con sus marcas de entrada y salida', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        name: 'Ada',
        email: 'ada@example.com',
        role: 'ADMIN',
        emailVerifiedAt: '2026-01-01',
        isApproved: true,
        isActive: true,
      })
      .mockResolvedValueOnce({
        total: 2,
        data: [
          {
            id: 'out-1',
            type: 'CHECK_OUT',
            status: 'EARLY_EXIT',
            date: '2026-05-24T00:00:00.000Z',
            time: '2026-05-24T23:29:00.000Z',
            user: { id: 'u1', name: 'Jorge Daniel Marrero Peiran', email: 'j@e.com' },
            event: { id: 'ev-1', title: 'Clase Jorge', type: 'CLASE' },
          },
          {
            id: 'in-1',
            type: 'CHECK_IN',
            status: 'PRESENT',
            date: '2026-05-24T00:00:00.000Z',
            time: '2026-05-24T23:21:00.000Z',
            user: { id: 'u1', name: 'Jorge Daniel Marrero Peiran', email: 'j@e.com' },
            event: { id: 'ev-1', title: 'Clase Jorge', type: 'CLASE' },
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 1,
        data: [
          {
            id: 'ev-1',
            title: 'Clase Jorge',
            type: 'CLASE',
            status: 'IN_PROGRESS',
            startDate: '2026-05-24T23:20:00.000Z',
            startTime: '2026-05-24T23:20:00.000Z',
            endTime: '2026-05-24T23:40:00.000Z',
            isRecurring: false,
            daysOfWeek: [],
            user: { id: 'admin', name: 'Admin', email: 'a@e.com', role: 'ADMIN' },
            assignedUser: { id: 'u1', name: 'Jorge Daniel Marrero Peiran', email: 'j@e.com', role: 'TEACHER' },
          },
        ],
      })

    render(<Home />)

    expect(await screen.findByText('Cronología operativa')).toBeInTheDocument()
    expect(screen.getAllByText('Clase Jorge')).toHaveLength(1)
    expect(screen.getByText('Salida anticipada')).toBeInTheDocument()
    expect(screen.getByText(/Entró/)).toBeInTheDocument()
    expect(screen.getByText(/Salió/)).toBeInTheDocument()
    expect(screen.queryByText('En Progreso')).not.toBeInTheDocument()
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
