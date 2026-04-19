import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ForgotPage from './page'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

/** No usar `Window` aquí: el `declare global` de `page.tsx` tipa `turnstile.render` y `vi.fn()` falla en CI con `tsc --noEmit`. */
function setTestTurnstile(stub: Record<string, unknown> | undefined) {
  ;(window as unknown as { turnstile?: Record<string, unknown> }).turnstile = stub
}

function deleteTestTurnstile() {
  delete (window as unknown as { turnstile?: Record<string, unknown> }).turnstile
}

describe('ForgotPage', () => {
  const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

  beforeEach(() => {
    vi.mocked(api).mockReset()
    deleteTestTurnstile()
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
    setTestTurnstile({ render: vi.fn() })

    render(<ForgotPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByText('Valida el captcha para continuar')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('renders the captcha widget and sends its token to the api', async () => {
    // En CI (jsdom) los rAF suelen diferirse: el click corre antes de renderWidget → sin token de captcha.
    const realRaf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key'
    const renderTurnstile = vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
      ;(options.callback as (token: string) => void)('captcha-token')
      return 'widget-mock'
    })
    setTestTurnstile({
      render: renderTurnstile,
      remove: vi.fn(),
      reset: vi.fn(),
    })
    vi.mocked(api).mockResolvedValueOnce({ ok: true })

    try {
      render(<ForgotPage />)
      await act(async () => {
        ;(window as unknown as { onloadTurnstileForgot?: () => void }).onloadTurnstileForgot?.()
      })
      // Asegurar que setCaptchaToken (callback de Turnstile) quede aplicado antes del submit.
      await act(async () => {
        await Promise.resolve()
      })

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
    } finally {
      globalThis.requestAnimationFrame = realRaf
    }
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
