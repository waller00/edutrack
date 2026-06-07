import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/components/notifications/WebPushSection', () => ({
  default: () => null,
}))

vi.mock('@/components/forms/PhoneBirthdateFields', () => ({
  default({
    phoneLocal,
    birthdate,
    onPhoneChange,
    onBirthdateChange,
  }: {
    phoneLocal: string
    birthdate: string
    onPhoneChange: (v: string) => void
    onBirthdateChange: (v: string) => void
  }) {
    return (
      <div>
        <input
          aria-label="Teléfono local"
          value={phoneLocal}
          onChange={(e) => onPhoneChange(e.target.value)}
        />
        <input
          aria-label="Fecha nacimiento"
          value={birthdate}
          onChange={(e) => onBirthdateChange(e.target.value)}
        />
      </div>
    )
  },
}))

const mockedApi = vi.mocked(api)

const baseMe = {
  username: 'teacher1',
  email: 't@school.edu',
  name: 'Teach',
  role: 'TEACHER',
  firstName: 'Ana',
  lastName: 'García',
  nationalId: '1.234.567-8',
  phone: '+59899123456',
  birthdate: '1990-05-10',
}

describe('ProfilePage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/profile' },
    })
  })

  it('redirige a login si /auth/me falla', async () => {
    mockedApi.mockRejectedValueOnce(new Error('401'))
    render(<ProfilePage />)
    await waitFor(() => expect(window.location.href).toBe('/login'))
  })

  it('muestra validación de usuario al guardar', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe, username: 'ab' }).mockResolvedValueOnce({ enabled: false })
    render(<ProfilePage />)
    await screen.findByText('Mi Perfil')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await waitFor(() => {
      expect(screen.getByText('Usuario inválido')).toBeInTheDocument()
    })
  })

  it('guarda perfil correctamente', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: false }).mockResolvedValueOnce({})
    render(<ProfilePage />)
    await screen.findByText('Mi Perfil')
    expect(screen.getByLabelText(/correo/i)).toHaveValue(baseMe.email)
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await waitFor(() => {
      expect(screen.getByText('Perfil actualizado')).toBeInTheDocument()
    })
    expect(mockedApi).toHaveBeenLastCalledWith(
      '/auth/profile',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"email":"t@school.edu"'),
      }),
    )
  })

  it('muestra acciones para contraseña y 2FA', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: false })
    render(<ProfilePage />)
    expect(await screen.findByText('Seguridad de la cuenta')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cambiar contraseña/i })).toHaveAttribute(
      'href',
      'http://localhost:4000/auth/account/password',
    )
    expect(screen.getByRole('link', { name: /configurar 2fa/i })).toHaveAttribute(
      'href',
      'http://localhost:4000/auth/account/2fa',
    )
  })

  it('permite desactivar 2FA con contraseña si ya está activo', async () => {
    mockedApi
      .mockResolvedValueOnce({ ...baseMe })
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ ok: true, removed: 1 })
    render(<ProfilePage />)

    expect(await screen.findByRole('button', { name: /desactivar 2fa/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /administrar 2fa/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /desactivar 2fa/i }))
    fireEvent.change(screen.getByLabelText(/contraseña actual/i), { target: { value: 'Secret123!' } })
    fireEvent.click(screen.getByRole('button', { name: /^desactivar$/i }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/auth/account/2fa',
        expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ password: 'Secret123!' }) }),
      ),
    )
  })
})
