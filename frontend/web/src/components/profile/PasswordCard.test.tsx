import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PasswordCard from './PasswordCard'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

const mockedApi = vi.mocked(api)

function apiError(message: string, data?: Record<string, unknown>) {
  return Object.assign(new Error(message), { data })
}

function fillPasswords(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Repetí la contraseña'), { target: { value: confirm } })
}

describe('PasswordCard', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/profile' },
    })
  })

  it('con contraseña ofrece cambiarla en Keycloak', async () => {
    mockedApi.mockResolvedValueOnce({ hasPassword: true })
    render(<PasswordCard username="ana.garcia" />)

    expect(await screen.findByRole('link', { name: /cambiar contraseña/i })).toHaveAttribute(
      'href',
      'http://localhost:4000/auth/account/password',
    )
    expect(screen.queryByRole('button', { name: 'Crear contraseña' })).not.toBeInTheDocument()
  })

  it('si no se puede consultar, deja "Cambiar contraseña" como antes', async () => {
    mockedApi.mockRejectedValueOnce(new Error('503'))
    render(<PasswordCard username="ana.garcia" />)

    expect(await screen.findByRole('link', { name: /cambiar contraseña/i })).toBeInTheDocument()
  })

  it('una cuenta de Google crea su contraseña desde el perfil', async () => {
    mockedApi.mockResolvedValueOnce({ hasPassword: false }).mockResolvedValueOnce({ ok: true })
    const onCreated = vi.fn()
    render(<PasswordCard username="ana.garcia" onCreated={onCreated} />)

    expect(await screen.findByText(/Creá una contraseña para entrar también con tu usuario \(ana\.garcia\)/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /cambiar contraseña/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña' }))
    fillPasswords('Segura123!')
    fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/account/password', {
        method: 'POST',
        body: JSON.stringify({ password: 'Segura123!' }),
      }),
    )
    expect(onCreated).toHaveBeenCalledWith(expect.stringMatching(/Contraseña creada/))
    expect(await screen.findByRole('link', { name: /cambiar contraseña/i })).toBeInTheDocument()
  })

  it('valida la contraseña y la confirmación antes de llamar a la API', async () => {
    mockedApi.mockResolvedValueOnce({ hasPassword: false })
    render(<PasswordCard username="ana.garcia" openCreate />)

    await screen.findByLabelText('Contraseña nueva')
    fillPasswords('corta')
    fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 8 caracteres/)

    fillPasswords('Segura123!', 'Distinta123!')
    fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.')
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('si el ingreso no es reciente manda a reautenticarse', async () => {
    mockedApi
      .mockResolvedValueOnce({ hasPassword: false })
      .mockRejectedValueOnce(apiError('Por seguridad, volvé a ingresar', { code: 'REAUTH_REQUIRED' }))
    render(<PasswordCard username="ana.garcia" openCreate />)

    await screen.findByLabelText('Contraseña nueva')
    fillPasswords('Segura123!')
    fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña' }))

    await waitFor(() => expect(window.location.href).toBe('http://localhost:4000/auth/account/reauth'))
  })

  it('muestra el mensaje de la API si la contraseña se rechaza', async () => {
    mockedApi
      .mockResolvedValueOnce({ hasPassword: false })
      .mockRejectedValueOnce(apiError('API 400', { message: 'Keycloak rechazó la contraseña' }))
    render(<PasswordCard username="ana.garcia" openCreate />)

    await screen.findByLabelText('Contraseña nueva')
    fillPasswords('Segura123!')
    fireEvent.click(screen.getByRole('button', { name: 'Crear contraseña' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak rechazó la contraseña')
  })
})
