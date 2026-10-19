import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ForgotPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

const mockedApi = vi.mocked(api)

describe('ForgotPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '', search: '' } })
  })

  it('precarga el correo que ya se escribió en la pantalla de ingreso', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '', search: '?email=ana%40example.com' } })
    render(<ForgotPage />)

    await waitFor(() => expect(screen.getByLabelText(/correo/i)).toHaveValue('ana@example.com'))
  })

  it('envía solicitud de recupero por correo', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true })
    render(<ForgotPage />)

    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: 'u@school.edu' } })
    fireEvent.click(screen.getByRole('button', { name: /enviar enlace/i }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/forgot-password', expect.objectContaining({ method: 'POST' })),
    )
    expect(screen.getByText(/vas a recibir el enlace/i)).toBeInTheDocument()
  })
})
