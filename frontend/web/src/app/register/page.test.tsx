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

  it('muestra el paso de datos si no hay sesión', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({ livenessCheckEnabled: false })

    render(<RegisterPage />)

    expect(await screen.findByText('Crear Cuenta')).toBeInTheDocument()
    // Arranca en el paso 1; la verificación de identidad vive en el paso 2.
    expect(screen.getByRole('textbox', { name: /correo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continuar$/i })).toBeInTheDocument()
    expect(
      screen.queryByText(/alta con verificación online no está disponible en este entorno/i),
    ).not.toBeInTheDocument()
  })

  it('revela los errores por campo al intentar continuar con el formulario vacío', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({ livenessCheckEnabled: true })
    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    fireEvent.submit(document.querySelector('form') as HTMLFormElement)

    expect(await screen.findByText(/el correo es obligatorio/i)).toBeInTheDocument()
    expect(screen.getByText(/la cédula es obligatoria/i)).toBeInTheDocument()
    expect(screen.getByText(/nombres es obligatorio/i)).toBeInTheDocument()
    // Sigue en el paso 1: no avanza con datos incompletos.
    expect(screen.getByRole('button', { name: /continuar$/i })).toBeDisabled()
  })

  it('valida en vivo mientras se escribe, sin esperar al envío', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({ livenessCheckEnabled: true })
    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    const email = screen.getByRole('textbox', { name: /correo/i })
    fireEvent.change(email, { target: { value: 'no-es-un-correo' } })
    fireEvent.blur(email)

    expect(await screen.findByText(/correo inválido/i)).toBeInTheDocument()

    fireEvent.change(email, { target: { value: 'juan@example.com' } })
    await waitFor(() => expect(screen.queryByText(/correo inválido/i)).not.toBeInTheDocument())
  })

  it('marca los campos obligatorios con asterisco accesible', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({ livenessCheckEnabled: true })
    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    // El asterisco es aria-hidden y lo acompaña un texto sr-only, así que el nombre
    // accesible del campo incluye "obligatorio" sin depender del color ni del símbolo.
    expect(screen.getByRole('textbox', { name: /correo.*obligatorio/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /nombres.*obligatorio/i })).toBeInTheDocument()
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

    const cancel = await screen.findByRole('button', { name: /^cancelar$/i })
    fireEvent.click(cancel)

    // Con alta por Google hay sesión abierta: cancelar tiene que cerrarla, y el
    // destino lleva `cancelled=1` para que /login no rebote al proveedor de identidad.
    await waitFor(() =>
      expect(locationMock.href).toBe(
        'http://localhost:4000/auth/logout?returnTo=%2Flogin%3Fcancelled%3D1',
      ),
    )
  })

  it('cancelar borra el borrador y el token de verificación pendientes', async () => {
    const locationMock = { href: '', replace: vi.fn(), search: '' }
    Object.defineProperty(window, 'location', { configurable: true, value: locationMock })
    sessionStorage.setItem('edutrack_register_draft', JSON.stringify({ v: 1 }))
    sessionStorage.setItem('edutrack_liveness_token', 'token-viejo')
    sessionStorage.setItem('edutrack.login.autostarted', '1')

    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({ livenessCheckEnabled: true })

    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    fireEvent.click(await screen.findByRole('button', { name: /^cancelar$/i }))

    await waitFor(() => expect(locationMock.href).toBe('/login?cancelled=1'))
    // Si algo de esto sobrevive, al volver a /register el wizard retoma un paso viejo.
    expect(sessionStorage.getItem('edutrack_register_draft')).toBeNull()
    expect(sessionStorage.getItem('edutrack_liveness_token')).toBeNull()
    expect(sessionStorage.getItem('edutrack.login.autostarted')).toBeNull()
  })
})
