import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VerifyPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

describe('VerifyPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
  })

  it('shows an error when the url has no token', async () => {
    window.history.pushState({}, '', '/verify')

    render(<VerifyPage />)

    expect(await screen.findByText('Enlace inválido o expirado')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('verifies the token and shows the success state', async () => {
    window.history.pushState({}, '', '/verify?token=abc123')
    vi.mocked(api).mockResolvedValueOnce({})

    render(<VerifyPage />)

    expect(await screen.findByText('Correo verificado')).toBeInTheDocument()
    expect(api).toHaveBeenCalledWith('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token: 'abc123' }),
    })
  })

  it('shows an error when verification fails', async () => {
    window.history.pushState({}, '', '/verify?token=abc123')
    vi.mocked(api).mockRejectedValueOnce(new Error('expired'))

    render(<VerifyPage />)

    await waitFor(() =>
      expect(screen.getByText('Enlace inválido o expirado')).toBeInTheDocument()
    )
  })
})
