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

function respond(profile: (init?: RequestInit) => unknown = () => ({}), me = baseMeResponse()) {
  mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/auth/me')) return me
    if (String(url).includes('check-username')) return { available: true, valid: true }
    if (String(url).includes('/auth/profile')) return profile(init)
    return {}
  })
}

describe('OnboardingPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/onboarding' },
    })
  })

  it('redirige a login si /auth/me falla', async () => {
    mockedApi.mockImplementation((url: string) =>
      String(url).includes('/auth/me') ? Promise.reject(new Error('401')) : Promise.resolve({}),
    )
    render(<OnboardingPage />)
    await waitFor(() => expect(window.location.href).toBe('/login'))
  })

  it('completa el perfil sin prueba de vida', async () => {
    respond()
    render(<OnboardingPage />)

    expect(await screen.findByText('Completa tu registro')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Verificar identidad/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ method: 'PUT' })),
    )
    // Ya no consulta nada de Didit.
    expect(mockedApi.mock.calls.some(([url]) => /didit|liveness|registration-options/.test(String(url)))).toBe(false)
    await waitFor(() => expect(window.location.href).toBe('/'))
  })

  it('valida los datos antes de guardar', async () => {
    respond(() => ({}), baseMeResponse({ nationalId: '12' }))
    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')

    fireEvent.submit(document.querySelector('form') as HTMLFormElement)

    expect(await screen.findByText(/La cédula no es válida/i)).toBeInTheDocument()
    expect(mockedApi.mock.calls.some(([url]) => String(url).includes('/auth/profile'))).toBe(false)
  })

  it('muestra error 409 al guardar perfil duplicado', async () => {
    respond(() => {
      throw Object.assign(new Error('409 Conflict'), { message: '409 username taken' })
    })
    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    expect(await screen.findByText(/Usuario o cédula ya registrados/i)).toBeInTheDocument()
  })
})
