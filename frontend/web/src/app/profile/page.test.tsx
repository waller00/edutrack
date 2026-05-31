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
    mockedApi.mockResolvedValueOnce({ ...baseMe, username: 'ab' })
    render(<ProfilePage />)
    await screen.findByText('Mi Perfil')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await waitFor(() => {
      expect(screen.getByText('Usuario inválido')).toBeInTheDocument()
    })
  })

  it('guarda perfil correctamente', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({})
    render(<ProfilePage />)
    await screen.findByText('Mi Perfil')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await waitFor(() => {
      expect(screen.getByText('Perfil actualizado')).toBeInTheDocument()
    })
  })

  it('muestra acciones para contraseña y 2FA', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe })
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
})
