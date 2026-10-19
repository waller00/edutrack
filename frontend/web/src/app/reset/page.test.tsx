import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ResetPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

const mockedApi = vi.mocked(api)

function openWith(search: string) {
  Object.defineProperty(window, 'location', { configurable: true, value: { href: '', search } })
}

function fillPasswords(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Repetí la contraseña'), { target: { value: confirm } })
}

describe('ResetPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('con el enlace del correo cambia la contraseña y ofrece ingresar', async () => {
    openWith('?token=tok-1')
    mockedApi.mockResolvedValueOnce({ ok: true })
    render(<ResetPage />)

    await screen.findByLabelText('Contraseña nueva')
    fillPasswords('Segura123!')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1', password: 'Segura123!' }),
      }),
    )
    expect(await screen.findByRole('heading', { name: 'Contraseña actualizada' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', expect.stringContaining('/auth/login'))
  })

  it('valida la contraseña y la confirmación antes de llamar a la API', async () => {
    openWith('?token=tok-1')
    render(<ResetPage />)

    await screen.findByLabelText('Contraseña nueva')
    fillPasswords('corta')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos 8 caracteres/)

    fillPasswords('Segura123!', 'Otra12345!')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.')
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('sin token dice que el enlace no sirve y ofrece pedir otro', async () => {
    openWith('')
    render(<ResetPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/venció o ya se usó/)
    expect(screen.getByRole('link', { name: 'Pedir otro enlace' })).toHaveAttribute('href', '/forgot')
  })

  it('si el enlace venció mientras tanto, lo dice en vez del formulario', async () => {
    openWith('?token=viejo')
    mockedApi.mockRejectedValueOnce(Object.assign(new Error('API 400'), { data: { code: 'RESET_TOKEN_INVALID' } }))
    render(<ResetPage />)

    await screen.findByLabelText('Contraseña nueva')
    fillPasswords('Segura123!')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    expect(await screen.findByRole('link', { name: 'Pedir otro enlace' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Contraseña nueva')).not.toBeInTheDocument()
  })

  it('muestra el mensaje de la API si se rechaza la contraseña', async () => {
    openWith('?token=tok-1')
    mockedApi.mockRejectedValueOnce(Object.assign(new Error('API 400'), { data: { message: 'Keycloak rechazó la contraseña' } }))
    render(<ResetPage />)

    await screen.findByLabelText('Contraseña nueva')
    fillPasswords('Segura123!')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Keycloak rechazó la contraseña')
  })
})
