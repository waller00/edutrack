import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ForgotPage from './page'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

describe('ForgotPage', () => {
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  beforeEach(() => {
    vi.mocked(api).mockReset()
    delete (window as Window & { turnstile?: { render: ReturnType<typeof vi.fn> } }).turnstile
    document.body.innerHTML = ''
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSiteKey
  })

  it('submits the email and shows the development reset url when available', async () => {
    vi.mocked(api).mockResolvedValueOnce({ ok: true, resetUrl: 'http://localhost/reset?token=abc' })

    render(<ForgotPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByText('Email enviado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'http://localhost/reset?token=abc' })).toHaveAttribute(
      'href',
      'http://localhost/reset?token=abc'
    )
  })

  it('requires captcha when turnstile is enabled and no token was produced', async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key'
    ;(window as Window & { turnstile?: { render: ReturnType<typeof vi.fn> } }).turnstile = {
      render: vi.fn(),
    }

    render(<ForgotPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByText('Valida el captcha para continuar')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('renders the captcha widget and sends its token to the api', async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key'
    const renderTurnstile = vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
      ;(options.callback as (token: string) => void)('captcha-token')
      return 'widget-mock'
    })
    ;(window as Window & { turnstile?: NonNullable<Window['turnstile']> }).turnstile = {
      render: renderTurnstile as NonNullable<Window['turnstile']>['render'],
      remove: vi.fn(),
      reset: vi.fn(),
    }
    vi.mocked(api).mockResolvedValueOnce({ ok: true })

    render(<ForgotPage />)
    ;(window as Window & { onloadTurnstileForgot?: () => void }).onloadTurnstileForgot?.()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/forgot', {
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', captchaToken: 'captcha-token' }),
      })
    )
    expect(renderTurnstile).toHaveBeenCalled()
    expect(screen.getByText('Email enviado')).toBeInTheDocument()
  })

  it('maps backend errors to user-facing messages', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('400 bad request'))

    render(<ForgotPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByText('Captcha inválido. Intenta nuevamente.')).toBeInTheDocument()

    vi.mocked(api).mockRejectedValueOnce(new Error('500'))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByText('No se pudo enviar el email. Intenta nuevamente.')).toBeInTheDocument()
  })
})
