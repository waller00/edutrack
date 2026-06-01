import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/components/forms/PhoneBirthdateFields', () => ({
  default: ({
    birthdate,
    onBirthdateChange,
  }: {
    birthdate: string
    onBirthdateChange: (v: string) => void
  }) => (
    <label>
      Fecha nacimiento
      <input
        data-testid="birthdate-input"
        type="date"
        value={birthdate}
        onChange={(e) => onBirthdateChange(e.target.value)}
      />
    </label>
  ),
}))

const mockedApi = vi.mocked(api)

function stubUrl() {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:reg'),
    revokeObjectURL: vi.fn(),
  })
}

describe('RegisterPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    stubUrl()
    const replace = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { replace },
    })
  })

  it('redirige si ya hay sesión', async () => {
    mockedApi
      .mockResolvedValueOnce({ email: 'x' })
      .mockResolvedValueOnce({ livenessCheckEnabled: false })

    render(<RegisterPage />)

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/'))
  })

  it('muestra formulario si no hay sesión', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({ livenessCheckEnabled: false })

    render(<RegisterPage />)

    expect(await screen.findByText('Crear Cuenta')).toBeInTheDocument()
    expect(
      await screen.findByText(/alta con verificación online no está disponible en este entorno/i),
    ).toBeInTheDocument()
  })

  it('muestra error de validación al enviar vacío', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({ livenessCheckEnabled: true })
    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')
    fireEvent.submit(document.querySelector('form') as HTMLFormElement)
    expect(await screen.findByText(/Email inválido/i)).toBeInTheDocument()
  })

  it('usa el Cancelar existente para salir del registro con Google', async () => {
    const locationMock = { href: '', replace: vi.fn(), search: '?sso=token-google-registration-1' }
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    })
    mockedApi.mockImplementation((path) => {
      if (path === '/auth/me') return Promise.reject(new Error('401'))
      if (String(path).startsWith('/auth/register/sso')) {
        return Promise.resolve({
          email: 'google@example.com',
          firstName: 'Google',
          lastName: 'User',
          emailLocked: true,
        })
      }
      return Promise.resolve({ livenessCheckEnabled: false })
    })

    render(<RegisterPage />)

    await waitFor(() => {
      const cancel = screen.getByRole('link', { name: /^cancelar$/i })
      expect(cancel).toHaveAttribute(
        'href',
        'http://localhost:4000/auth/logout?returnTo=%2Flogin',
      )
    })
  })
})
