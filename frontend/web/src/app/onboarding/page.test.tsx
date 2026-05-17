import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))

const mockedApi = vi.mocked(api)

function baseMeResponse(overrides: Record<string, unknown> = {}) {
  return {
    email: 'g@g.com',
    role: 'STAFF',
    hasPassword: true,
    username: 'ana.garcia',
    firstName: 'Ana',
    lastName: 'García',
    nationalId: '41234563',
    birthdate: '1995-03-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    vi.stubGlobal('URL', URL)
    try {
      window.sessionStorage.removeItem('edutrack_liveness_token')
    } catch {
      /* */
    }
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/onboarding' },
    })
  })

  it('redirige a login si /auth/me falla', async () => {
    mockedApi.mockImplementation((url: string) => {
      if (String(url).includes('/auth/me')) return Promise.reject(new Error('401'))
      return Promise.resolve({ livenessCheckEnabled: false })
    })
    render(<OnboardingPage />)
    await waitFor(() => expect(window.location.href).toBe('/login'))
  })

  it('muestra flujo Didit de completar perfil', async () => {
    mockedApi.mockImplementation((url: string) => {
      if (String(url).includes('/auth/me')) return Promise.resolve(baseMeResponse({ username: '', firstName: '', lastName: '' }))
      if (String(url).includes('registration-options')) return Promise.resolve({ livenessCheckEnabled: true })
      if (String(url).includes('check-username')) return Promise.resolve({ available: true, valid: true })
      return Promise.resolve({})
    })

    render(<OnboardingPage />)

    expect(await screen.findByText('Completa tu registro')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Verificar identidad/i })).toBeInTheDocument()
  })

  it('bloquea envío sin verificación Didit completada', async () => {
    mockedApi.mockImplementation((url: string) => {
      if (String(url).includes('/auth/me')) return Promise.resolve(baseMeResponse())
      if (String(url).includes('registration-options')) return Promise.resolve({ livenessCheckEnabled: true })
      if (String(url).includes('check-username')) return Promise.resolve({ available: true, valid: true })
      return Promise.resolve({})
    })

    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')

    const form = document.querySelector('form')
    expect(form).toBeTruthy()
    fireEvent.submit(form as HTMLFormElement)

    expect(await screen.findByText(/Debés confirmar tu identidad antes de continuar/i)).toBeInTheDocument()
  })

  it('guarda perfil tras Didit y cruce de campos', async () => {
    window.sessionStorage.setItem('edutrack_liveness_token', 'didit-test-token')
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        href: 'http://localhost/onboarding?liveness=1&status=approved&verificationSessionId=didit-test-token',
        search: '?liveness=1&status=approved&verificationSessionId=didit-test-token',
        pathname: '/onboarding',
        replace: vi.fn(),
        assign: vi.fn(),
      },
    })

    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/me')) {
        return baseMeResponse()
      }
      if (String(url).includes('registration-options')) {
        return { livenessCheckEnabled: true }
      }
      if (String(url).includes('check-username')) {
        return { available: true, valid: true }
      }
      if (String(url).includes('/auth/liveness/status')) {
        return { approved: true }
      }
      if (String(url).includes('/auth/didit/register-field-verify')) {
        return {
          success: true,
          verifiedFields: 5,
          totalFields: 5,
          verification: {
            firstName: { provided: 'Ana', extracted: 'Ana', message: '✓ Coincide' },
            lastName: { provided: 'García', extracted: 'García', message: '✓ Coincide' },
            nationalId: { provided: '4.123.456-3', extracted: '4.123.456-3', message: '✓ Coincide' },
            birthdate: { provided: '1995-03-15', extracted: '1995-03-15', message: '✓ Coincide' },
            nationalIdDocumentExpiresAt: {
              provided: '—',
              extracted: '2030-06-01',
              message: '✓ Coincide',
            },
          },
        }
      }
      if (String(url).includes('/auth/profile') && init?.method === 'PUT') {
        return {}
      }
      return {}
    })

    render(<OnboardingPage />)

    await screen.findByText('Completa tu registro')
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/didit/register-field-verify', expect.objectContaining({ method: 'POST' })),
    )

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ method: 'PUT' })),
    )
  })

  it('muestra error 409 al guardar perfil duplicado', async () => {
    window.sessionStorage.setItem('edutrack_liveness_token', 'didit-test-token')
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        href: 'http://localhost/onboarding?liveness=1&status=approved&verificationSessionId=didit-test-token',
        search: '?liveness=1&status=approved&verificationSessionId=didit-test-token',
        pathname: '/onboarding',
        replace: vi.fn(),
        assign: vi.fn(),
      },
    })

    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/me')) {
        return baseMeResponse()
      }
      if (String(url).includes('registration-options')) {
        return { livenessCheckEnabled: true }
      }
      if (String(url).includes('check-username')) {
        return { available: true, valid: true }
      }
      if (String(url).includes('/auth/liveness/status')) {
        return { approved: true }
      }
      if (String(url).includes('/auth/didit/register-field-verify')) {
        return {
          success: true,
          verifiedFields: 5,
          totalFields: 5,
          verification: {
            firstName: { provided: 'Ana', message: '✓ OK' },
            lastName: { provided: 'G', message: '✓ OK' },
            nationalId: { provided: 'x', message: '✓ OK' },
            birthdate: { provided: 'x', message: '✓ OK' },
            nationalIdDocumentExpiresAt: { provided: '(OCR)', extracted: '2030-01-01', message: '✓ OK' },
          },
        }
      }
      if (String(url).includes('/auth/profile')) {
        throw Object.assign(new Error('409 Conflict'), { message: '409 username taken' })
      }
      return {}
    })

    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/auth/didit/register-field-verify'), expect.anything()))

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    expect(await screen.findByText(/Usuario o cédula ya registrados/i)).toBeInTheDocument()
  })
})
