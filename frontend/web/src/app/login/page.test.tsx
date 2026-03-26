import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './page'
import { api } from '@/lib/api'

const replace = vi.fn()
const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    vi.mocked(api).mockRejectedValue(new Error('unauthorized'))
    replace.mockReset()
    push.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/login', search: '' },
    })
  })

  it('redirects users who already have a session', async () => {
    vi.mocked(api).mockResolvedValueOnce({ ok: true })

    render(<LoginPage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('shows the external inactive error and toggles password visibility', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/login?error=inactive', search: '?error=inactive' },
    })

    render(<LoginPage />)

    expect(await screen.findByText('Tu cuenta está dada de baja. Contacta a un administrador.')).toBeInTheDocument()

    const passwordInput = screen.getByPlaceholderText('Ingresa tu contraseña')
    expect(passwordInput).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(passwordInput).toHaveAttribute('type', 'text')
  })

  it('submits credentials and redirects to home', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/auth/me') throw new Error('unauthorized')
      if (path === '/auth/login') return {}
      throw new Error(`unexpected path ${path}`)
    })

    render(<LoginPage />)

    fireEvent.change(await screen.findByPlaceholderText('Ingresa tu email o usuario'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Ingresa tu contraseña'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: 'ada@example.com', password: 'secret123' }),
      })
    )
    expect(window.location.href).toBe('/')
  })

  it('maps backend login errors and supports google/register navigation', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.local'
    const loginErrors = [
      new Error('429 too many requests'),
      new Error('cuenta desactivada'),
      new Error('other'),
    ]
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/auth/me') throw new Error('unauthorized')
      if (path === '/auth/login') throw loginErrors.shift() ?? new Error('other')
      throw new Error(`unexpected path ${path}`)
    })

    render(<LoginPage />)

    fireEvent.change(await screen.findByPlaceholderText('Ingresa tu email o usuario'), { target: { value: 'ada@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('Ingresa tu contraseña'), { target: { value: 'secret123' } })

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Tu cuenta está temporalmente bloqueada por intentos fallidos. Intenta más tarde.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Tu cuenta está dada de baja. Contacta a un administrador.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Google' }))
    expect(window.location.href).toBe('http://api.local/auth/google')

    fireEvent.click(screen.getByRole('button', { name: 'Regístrate aquí' }))
    expect(push).toHaveBeenCalledWith('/register')
  })
})
