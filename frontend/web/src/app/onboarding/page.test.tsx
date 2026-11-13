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

  it('con el perfil completo vuelve al inicio: no ofrece mandar el alta otra vez', async () => {
    respond(() => ({}), baseMeResponse({ isApproved: true, needsProfileCompletion: false }))
    render(<OnboardingPage />)

    await waitFor(() => expect(window.location.href).toBe('/'))
    expect(screen.queryByText('Completa tu registro')).not.toBeInTheDocument()
    expect(mockedApi.mock.calls.some(([url]) => String(url).includes('check-username'))).toBe(false)
  })

  it('el usuario que ya tiene la cuenta es suyo, no "No disponible", y deja guardar', async () => {
    // Para el servidor está ocupado: lo ocupa la propia cuenta.
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('/auth/me')) return baseMeResponse({ needsProfileCompletion: true })
      if (String(url).includes('check-username')) return { available: false, valid: true }
      return {}
    })
    render(<OnboardingPage />)

    expect(await screen.findByText('Es tu usuario')).toBeInTheDocument()
    expect(screen.queryByText('No disponible')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ method: 'PUT' })),
    )
    expect(mockedApi.mock.calls.some(([url]) => String(url).includes('check-username?u=ana.garcia'))).toBe(false)
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

  /** El cuerpo que mandó `PUT /auth/profile`. */
  function profileBody() {
    const call = mockedApi.mock.calls.find(([url]) => String(url).includes('/auth/profile'))
    return JSON.parse(String((call?.[1] as RequestInit | undefined)?.body))
  }

  it('una cuenta aprobada (la creó Administración o Secretaría) completa sus datos sin mandar perfil', async () => {
    // El servidor no deja que una cuenta aprobada se cambie el perfil: mandarlo era un 403.
    respond(() => ({}), baseMeResponse({ role: 'TEACHER', isApproved: true }))
    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')
    expect(screen.queryByLabelText('Perfil')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    await waitFor(() => expect(mockedApi.mock.calls.some(([url]) => String(url).includes('/auth/profile'))).toBe(true))
    expect(profileBody()).not.toHaveProperty('role')
  })

  it('una cuenta pendiente que pidió Secretaría no pasa a Personal al completar sus datos', async () => {
    respond(() => ({}), baseMeResponse({ role: 'SECRETARIA', isApproved: false }))
    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')
    expect(screen.queryByLabelText('Perfil')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    await waitFor(() => expect(mockedApi.mock.calls.some(([url]) => String(url).includes('/auth/profile'))).toBe(true))
    expect(profileBody()).not.toHaveProperty('role')
  })

  it('una cuenta pendiente de Docente o Personal todavía elige entre los dos', async () => {
    respond(() => ({}), baseMeResponse({ role: 'STAFF', isApproved: false }))
    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')
    fireEvent.change(screen.getByLabelText('Perfil'), { target: { value: 'TEACHER' } })

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    await waitFor(() => expect(mockedApi.mock.calls.some(([url]) => String(url).includes('/auth/profile'))).toBe(true))
    expect(profileBody().role).toBe('TEACHER')
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
