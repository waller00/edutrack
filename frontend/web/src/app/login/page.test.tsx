import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import LoginPage from './page'

const { replaceMock, routerMock } = vi.hoisted(() => {
  const replace = vi.fn()
  return { replaceMock: replace, routerMock: { replace } }
})

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

// Estable como el de Next: el efecto de la página depende de `router`, y un objeto nuevo por
// render lo re-ejecuta y pisa el estado que dejó la primera respuesta de `/auth/me`.
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
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

  it('si la cuenta de acceso no tiene vínculo válido pide revisión a administración, no reintentar', async () => {
    const linkLocationMock = { href: '', search: '?error=account_link' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: linkLocationMock,
    })

    render(<LoginPage />)

    expect(await screen.findByRole('heading', { name: /Tu acceso necesita revisión/i })).toBeInTheDocument()
    expect(screen.getByText(/Pedile a administración que la revise/i)).toBeInTheDocument()
    expect(screen.queryByText(/Volvé a intentar/i)).not.toBeInTheDocument()
    expect(linkLocationMock.href).toBe('')
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
    // Recuperar (o crear, si entra con Google) la contraseña no depende del JS de Keycloak.
    expect(screen.getByRole('link', { name: /Olvidaste tu contraseña/i })).toHaveAttribute('href', '/forgot')
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

  function blockedError(code: string, email = 'nuevo@example.com') {
    const err = new Error('Correo sin verificar') as Error & { status?: number; data?: unknown }
    err.status = 403
    err.data = { message: 'Correo sin verificar', code, email }
    return err
  }

  it('si falta verificar el correo lo dice y ofrece reenviarlo con la sesión', async () => {
    vi.mocked(api).mockRejectedValueOnce(blockedError('EMAIL_NOT_VERIFIED'))
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '', search: '' } })

    render(<LoginPage />)

    expect(await screen.findByRole('heading', { name: 'Verificá tu correo' })).toBeInTheDocument()
    expect(screen.getByText(/te mandamos un enlace a nuevo@example\.com/i)).toBeInTheDocument()
    vi.mocked(api).mockResolvedValueOnce({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo' }))
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/verify/request', { method: 'POST', body: JSON.stringify({}) }),
    )
  })

  it('con el correo verificado dice que falta la aprobación, sin ofrecer reenvío', async () => {
    vi.mocked(api).mockRejectedValueOnce(blockedError('PENDING_APPROVAL'))
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '', search: '' } })

    render(<LoginPage />)

    expect(await screen.findByRole('heading', { name: 'Tu cuenta espera aprobación' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument()
    // Ya está registrado: "Registrarse" no le sirve, y no tiene otra cuenta a la que cambiar.
    expect(screen.queryByRole('link', { name: 'Registrarse' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
  })

  it('una cuenta inhabilitada sí ofrece cambiar de cuenta', async () => {
    vi.mocked(api).mockRejectedValueOnce(blockedError('ACCOUNT_INACTIVE'))
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '', search: '' } })

    render(<LoginPage />)

    expect(await screen.findByRole('button', { name: 'Cerrar sesión y cambiar cuenta' })).toBeInTheDocument()
  })

  it('recién registrado no inicia el login solo ni repite los pasos del alta', async () => {
    const registeredLocation = { href: '', search: '?registered=1' }
    Object.defineProperty(window, 'location', { configurable: true, value: registeredLocation })

    render(<LoginPage />)

    expect(await screen.findByRole('heading', { name: 'Registro enviado' })).toBeInTheDocument()
    expect(screen.getByText(/cuando administración apruebe tu cuenta/i)).toBeInTheDocument()
    expect(screen.queryByText(/Aprobación de administración/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Registrarse' })).not.toBeInTheDocument()
    expect(registeredLocation.href).toBe('')
  })
})
