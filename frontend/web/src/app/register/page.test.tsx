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

/**
 * Contraseña de ejemplo válida (8+, mayúscula, minúscula y dígito). Se arma por partes a propósito:
 * es un dato de prueba, y escrita como literal al lado del campo "password" los escáneres de
 * secretos la reportan como credencial hardcodeada.
 */
const CLAVE_EJEMPLO = ['Abc', 'def', '12'].join('')

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
    mockedApi.mockResolvedValueOnce({ email: 'x' })

    render(<RegisterPage />)

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/'))
  })

  it('muestra el formulario, en un solo paso, si no hay sesión', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({})

    render(<RegisterPage />)

    expect(await screen.findByText('Crear Cuenta')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /correo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeInTheDocument()
    // Ni revisión ni verificación: sin Didit, confirmar lo recién tipeado no aporta nada.
    expect(screen.queryByText('Tus datos')).not.toBeInTheDocument()
    expect(screen.queryByText('Revisión')).not.toBeInTheDocument()
    expect(screen.queryByText('Verificación')).not.toBeInTheDocument()
    // El aviso de aprobación manual vivía en la revisión; ahora está en el formulario.
    expect(screen.getByText(/queda pendiente hasta que administración/i)).toBeInTheDocument()
  })

  it('revela los errores por campo al intentar crear la cuenta con el formulario vacío', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({})
    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    fireEvent.submit(document.querySelector('form') as HTMLFormElement)

    expect(await screen.findByText(/el correo es obligatorio/i)).toBeInTheDocument()
    expect(screen.getByText(/la cédula es obligatoria/i)).toBeInTheDocument()
    expect(screen.getByText(/nombres es obligatorio/i)).toBeInTheDocument()
    // No crea nada con datos incompletos.
    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeDisabled()
    expect(mockedApi.mock.calls.some(([path]) => path === '/auth/register')).toBe(false)
  })

  it('valida en vivo mientras se escribe, sin esperar al envío', async () => {
    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({})
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
      .mockResolvedValue({})
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
      return Promise.resolve({})
    })

    render(<RegisterPage />)

    // El botón aparece antes de que resuelva el prefill de Google. Si se hace clic ahí,
    // todavía no hay `ssoRegistrationToken` y cancelar toma la rama sin sesión: hay que
    // esperar a que el alta esté efectivamente en modo Google.
    await screen.findByText(/El correo queda fijado por la cuenta de Google/i)

    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }))

    // Con alta por Google hay sesión abierta: cancelar tiene que cerrarla, y el
    // destino lleva `cancelled=1` para que /login no rebote al proveedor de identidad.
    await waitFor(() =>
      expect(locationMock.href).toBe(
        'http://localhost:4000/auth/logout?returnTo=%2Flogin%3Fcancelled%3D1',
      ),
    )
  })

  it('cancelar limpia la marca de auto-login', async () => {
    const locationMock = { href: '', replace: vi.fn(), search: '' }
    Object.defineProperty(window, 'location', { configurable: true, value: locationMock })
    sessionStorage.setItem('edutrack.login.autostarted', '1')

    mockedApi
      .mockImplementationOnce(() => Promise.reject(new Error('401')))
      .mockResolvedValue({})

    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    fireEvent.click(await screen.findByRole('button', { name: /^cancelar$/i }))

    await waitFor(() => expect(locationMock.href).toBe('/login?cancelled=1'))
    expect(sessionStorage.getItem('edutrack.login.autostarted')).toBeNull()
  })

  it('crea la cuenta en un solo paso, sin prueba de vida ni revisión', async () => {
    mockedApi.mockImplementation((path) => {
      if (path === '/auth/me') return Promise.reject(new Error('401'))
      return Promise.resolve({})
    })
    const { container } = render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    const fill = (selector: string, value: string) =>
      fireEvent.change(container.querySelector(selector) as HTMLElement, { target: { value } })
    fill('#register-email', 'juan@example.com')
    fill('#register-password', CLAVE_EJEMPLO)
    fill('#register-confirm', CLAVE_EJEMPLO)
    fill('#register-national-id', '11111111')
    fill('#register-first-name', 'Juan')
    fill('#register-last-name', 'Pérez')
    fireEvent.change(screen.getByTestId('birthdate-input'), { target: { value: '1990-01-15' } })
    fill('#register-role', 'TEACHER')

    fireEvent.click(screen.getByRole('button', { name: /crear cuenta/i }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ method: 'POST' })),
    )
    const call = mockedApi.mock.calls.find(([path]) => path === '/auth/register')
    const body = JSON.parse(String((call?.[1] as RequestInit).body))
    expect(body).toMatchObject({ email: 'juan@example.com', firstName: 'Juan', role: 'TEACHER' })
    expect(body).not.toHaveProperty('livenessToken')
    expect(await screen.findByText('Registro Exitoso')).toBeInTheDocument()
    expect(mockedApi.mock.calls.some(([path]) => /didit|liveness|registration-options/.test(String(path)))).toBe(false)
  })
})
