import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './page'
import { api } from '@/lib/api'
import { STRONG_PASSWORD_MESSAGE } from '@/lib/password-strength'

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

vi.mock('@/components/PhoneBirthdateFields', () => ({
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
  hasPassword: true,
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
    mockedApi.mockResolvedValueOnce({
      ...baseMe,
      username: 'ab',
    })

    render(<ProfilePage />)

    await screen.findByText('Mi Perfil')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => {
      expect(screen.getByText('Usuario inválido')).toBeInTheDocument()
    })
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('guarda perfil correctamente', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({})

    render(<ProfilePage />)

    await screen.findByText('Mi Perfil')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => {
      expect(screen.getByText('Perfil actualizado')).toBeInTheDocument()
    })
    expect(mockedApi).toHaveBeenLastCalledWith(
      '/auth/profile',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('admin con cédula inválida muestra error', async () => {
    mockedApi.mockResolvedValueOnce({
      ...baseMe,
      role: 'ADMIN',
      nationalId: '99',
    })

    render(<ProfilePage />)

    await screen.findByText('Mi Perfil')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(screen.getByText('Cédula inválida')).toBeInTheDocument())
  })

  it('error 409 al guardar perfil', async () => {
    mockedApi
      .mockResolvedValueOnce({ ...baseMe })
      .mockRejectedValueOnce({ message: '409 Conflict' })

    render(<ProfilePage />)

    await screen.findByText('Mi Perfil')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    await waitFor(() => expect(screen.getByText(/ya registrados/)).toBeInTheDocument())
  })

  it('contraseñas que no coinciden', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe })

    render(<ProfilePage />)

    await screen.findByText('Seguridad')
    fireEvent.change(screen.getByPlaceholderText('Mín 8, Aa y 0-9'), { target: { value: 'Abcdef12' } })
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'Xyz78901' } })
    fireEvent.click(screen.getByRole('button', { name: /actualizar contraseña/i }))

    await waitFor(() => expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument())
  })

  it('contraseña débil', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe })

    render(<ProfilePage />)

    await screen.findByText('Seguridad')
    fireEvent.change(screen.getByPlaceholderText('Tu contraseña actual'), { target: { value: 'old' } })
    fireEvent.change(screen.getByPlaceholderText('Mín 8, Aa y 0-9'), { target: { value: 'alllower1' } })
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'alllower1' } })
    fireEvent.click(screen.getByRole('button', { name: /actualizar contraseña/i }))

    await waitFor(() => expect(screen.getByText(STRONG_PASSWORD_MESSAGE)).toBeInTheDocument())
  })

  it('actualiza contraseña con éxito', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({})

    render(<ProfilePage />)

    await screen.findByText('Seguridad')
    fireEvent.change(screen.getByPlaceholderText('Tu contraseña actual'), { target: { value: 'OldPass1' } })
    fireEvent.change(screen.getByPlaceholderText('Mín 8, Aa y 0-9'), { target: { value: 'NewPass2' } })
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'NewPass2' } })
    fireEvent.click(screen.getByRole('button', { name: /actualizar contraseña/i }))

    await waitFor(() => expect(screen.getByText('Contraseña actualizada')).toBeInTheDocument())
  })

  it('error 401 al cambiar contraseña', async () => {
    mockedApi
      .mockResolvedValueOnce({ ...baseMe })
      .mockRejectedValueOnce({ message: '401 Unauthorized' })

    render(<ProfilePage />)

    await screen.findByText('Seguridad')
    fireEvent.change(screen.getByPlaceholderText('Tu contraseña actual'), { target: { value: 'Wrong1' } })
    fireEvent.change(screen.getByPlaceholderText('Mín 8, Aa y 0-9'), { target: { value: 'NewPass2' } })
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'NewPass2' } })
    fireEvent.click(screen.getByRole('button', { name: /actualizar contraseña/i }))

    await waitFor(() => expect(screen.getByText(/incorrecta/)).toBeInTheDocument())
  })

  it('sin contraseña (Google) muestra aviso', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe, hasPassword: false })

    render(<ProfilePage />)

    expect(await screen.findByText(/Sin contraseña configurada/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Tu contraseña actual')).not.toBeInTheDocument()
  })

  it('toggle visibilidad contraseña actual', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe })

    render(<ProfilePage />)

    await screen.findByText('Seguridad')
    const cur = screen.getByPlaceholderText('Tu contraseña actual')
    expect(cur).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña actual' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Tu contraseña actual')).toHaveAttribute('type', 'text')
    })
  })
})
