import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResendVerificationEmail } from './ResendVerificationEmail'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))

const mockedApi = vi.mocked(api)

describe('ResendVerificationEmail', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reenvía al correo indicado y arranca la cuenta regresiva', async () => {
    mockedApi.mockResolvedValueOnce({ ok: true, cooldownSeconds: 60 })
    render(<ResendVerificationEmail email="ana@example.com" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/verify/request', {
        method: 'POST',
        body: JSON.stringify({ email: 'ana@example.com' }),
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/te mandamos un enlace nuevo/i)
    expect(screen.getByRole('button', { name: 'Reenviar en 60 s' })).toBeDisabled()
  })

  it('recién enviado espera antes de permitir otro envío y después se habilita', () => {
    vi.useFakeTimers()
    render(<ResendVerificationEmail email="ana@example.com" justSent />)

    expect(screen.getByRole('button', { name: 'Reenviar en 60 s' })).toBeDisabled()
    for (let i = 0; i < 60; i++) {
      act(() => {
        vi.advanceTimersByTime(1000)
      })
    }
    expect(screen.getByRole('button', { name: 'Reenviar correo' })).toBeEnabled()
  })

  it('sin correo conocido lo pide y valida el formato antes de llamar a la API', async () => {
    render(<ResendVerificationEmail />)

    fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Escribí el correo/)
    expect(mockedApi).not.toHaveBeenCalled()

    mockedApi.mockResolvedValueOnce({ ok: true })
    fireEvent.change(screen.getByLabelText('Correo con el que te registraste'), {
      target: { value: 'juan@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/verify/request', {
        method: 'POST',
        body: JSON.stringify({ email: 'juan@example.com' }),
      }),
    )
  })

  it('con sesión no pide el correo y avisa si hubo demasiados pedidos', async () => {
    const err = Object.assign(new Error('Demasiadas'), { status: 429 })
    mockedApi.mockRejectedValueOnce(err)
    render(<ResendVerificationEmail useSession />)

    expect(screen.queryByLabelText('Correo con el que te registraste')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/muchos pedidos seguidos/)
    expect(mockedApi).toHaveBeenCalledWith('/auth/verify/request', { method: 'POST', body: JSON.stringify({}) })
  })
})
