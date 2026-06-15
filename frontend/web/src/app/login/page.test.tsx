import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoginPage from './page'

const replaceMock = vi.fn()

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}))

import { api } from '@/lib/api/client'

describe('LoginPage (Keycloak)', () => {
  const locationMock = { href: '' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api).mockRejectedValue(new Error('401'))
    window.sessionStorage.clear()
    locationMock.href = ''
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    })
  })

  it('redirige automaticamente al BFF cuando no hay sesion', async () => {
    render(<LoginPage />)
    await waitFor(() => expect(locationMock.href).toContain('/auth/login'))
    expect(locationMock.href).toContain('returnTo=%2F')
  })

  it('no vuelve a iniciar login automaticamente si ya hubo un intento en la pestaña', async () => {
    window.sessionStorage.setItem('edutrack.login.autostarted', '1')

    render(<LoginPage />)

    expect(await screen.findByRole('button', { name: /Ingresar/i })).toBeInTheDocument()
    expect(screen.getByText(/demasiadas solicitudes/i)).toBeInTheDocument()
    expect(locationMock.href).toBe('')
  })

  it('respeta returnTo seguro para usuarios autenticados', async () => {
    vi.mocked(api).mockResolvedValueOnce({ id: 'u1' })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '', search: '?returnTo=%2Fadmin%2Fusers' },
    })

    render(<LoginPage />)

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/admin/users'))
  })

  it('muestra recuperacion si Keycloak devuelve error', async () => {
    const errorLocationMock = { href: '', search: '?error=oidc' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: errorLocationMock,
    })

    render(<LoginPage />)

    const btn = await screen.findByRole('button', { name: /Ingresar/i })
    expect(screen.queryByText(/Keycloak|proveedor de identidad/i)).not.toBeInTheDocument()
    expect(screen.getByText(/contactá al soporte de EduTrack/i)).toBeInTheDocument()
    expect(errorLocationMock.href).toBe('')
    fireEvent.click(btn)
    expect(errorLocationMock.href).toContain('/auth/login')
  })

  it('no redirige automaticamente despues de cerrar sesion', async () => {
    const loggedOutLocationMock = { href: '', search: '?loggedOut=1' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: loggedOutLocationMock,
    })

    render(<LoginPage />)

    expect(await screen.findByRole('heading', { name: /Sesión cerrada/i })).toBeInTheDocument()
    expect(screen.queryByText(/Keycloak|proveedor de identidad/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Cerramos tu sesión correctamente/i)).toBeInTheDocument()
    expect(loggedOutLocationMock.href).toBe('')
  })

  it('no reintenta login en bucle si la cuenta esta pendiente o inhabilitada', async () => {
    const err = new Error('Cuenta inhabilitada') as Error & { status?: number }
    err.status = 403
    vi.mocked(api).mockRejectedValueOnce(err)
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '', search: '' },
    })

    render(<LoginPage />)

    expect(await screen.findByRole('heading', { name: /Cuenta no habilitada/i })).toBeInTheDocument()
    expect(locationMock.href).toBe('')
  })
})
