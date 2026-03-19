import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResetPage from './page'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

describe('ResetPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    window.history.pushState({}, '', '/reset?token=abc123')
  })

  it('validates password length', async () => {
    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    expect(await screen.findByText('La contraseña debe tener al menos 8 caracteres')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('validates password confirmation', async () => {
    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: '87654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('submits the reset token and shows the success state', async () => {
    vi.mocked(api).mockResolvedValueOnce({})

    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ token: 'abc123', password: '12345678' }),
      })
    )
    expect(screen.getByText('Tu contraseña fue actualizada correctamente.')).toBeInTheDocument()
  })

  it('shows an invalid-link error when the reset request fails', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('expired'))

    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    expect(await screen.findByText('El enlace es inválido o expiró')).toBeInTheDocument()
  })
})
