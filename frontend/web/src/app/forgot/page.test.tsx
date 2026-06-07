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
