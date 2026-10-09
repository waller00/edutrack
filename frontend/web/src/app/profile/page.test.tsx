import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './page'
import { AuthProvider } from '@/contexts/AuthContext'
import WebPushSection from '@/components/notifications/WebPushSection'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/lib/observability/user-session', () => ({
  identifyObservabilityUser: vi.fn(),
  clearObservabilityUser: vi.fn(),
}))

function renderProfile() {
  return render(
    <AuthProvider>
      <ProfilePage />
    </AuthProvider>,
  )
}

vi.mock('@/components/notifications/WebPushSection', () => ({
  default: vi.fn(() => <p>Preferencias del navegador</p>),
}))

vi.mock('@/components/forms/PhoneBirthdateFields', () => ({
  default({
    phoneLocal,
    birthdate,
    onPhoneChange,
    onBirthdateChange,
  }: {
    phoneLocal: string
    birthdate: string
    onPhoneChange: (v: string) => void
    onBirthdateChange: (v: string) => void
  }) {
    return (
      <div>
        <input
          aria-label="Teléfono local"
          value={phoneLocal}
          onChange={(e) => onPhoneChange(e.target.value)}
        />
        <input
          aria-label="Fecha nacimiento"
          value={birthdate}
          onChange={(e) => onBirthdateChange(e.target.value)}
        />
      </div>
    )
  },
}))

const mockedApi = vi.mocked(api)

/**
 * "Mi Perfil" se ve antes de que lleguen los datos, y un efecto los copia al formulario después.
 * Escribir o buscar el usuario apenas aparece el título fallaba según la velocidad de la máquina
 * (en CI, con cobertura): se espera a que el formulario tenga el correo.
 */
async function waitForProfileLoaded(email = 't@school.edu') {
  await screen.findByText('Mi Perfil')
  await waitFor(() => expect(screen.getByLabelText('Correo')).toHaveValue(email))
}

const baseMe = {
  id: 'u1',
  username: 'teacher1',
  email: 't@school.edu',
  name: 'Teach',
  role: 'TEACHER',
  firstName: 'Ana',
  lastName: 'García',
  nationalId: '1.234.567-8',
  phone: '+59899123456',
  birthdate: '1990-05-10',
}

describe('ProfilePage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    vi.mocked(WebPushSection).mockClear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/profile' },
    })
  })

  it('redirige a login si /auth/me falla', async () => {
    mockedApi.mockRejectedValueOnce(new Error('401'))
    renderProfile()
    await waitFor(() => expect(window.location.href).toBe('/login'))
  })

  it('muestra validación de correo al guardar', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe, email: 'correo-malo' }).mockResolvedValueOnce({ enabled: false })
    renderProfile()
    await waitForProfileLoaded('correo-malo')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await waitFor(() => {
      expect(screen.getByText('Correo inválido')).toBeInTheDocument()
    })
  })

  it('guarda perfil correctamente', async () => {
    mockedApi
      .mockResolvedValueOnce({ ...baseMe }) // AuthProvider /auth/me
      .mockResolvedValueOnce({ enabled: false }) // estado 2fa
      .mockResolvedValueOnce({}) // PUT /auth/profile
      .mockResolvedValueOnce({ ...baseMe }) // refresh() tras guardar
    renderProfile()
    await waitForProfileLoaded()
    expect(screen.getByLabelText(/correo/i)).toHaveValue(baseMe.email)
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await waitFor(() => {
      expect(screen.getByText('Perfil actualizado')).toBeInTheDocument()
    })
    expect(mockedApi).toHaveBeenCalledWith(
      '/auth/profile',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"email":"t@school.edu"'),
      }),
    )
  })

  it('muestra acciones para contraseña y 2FA', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: false })
    renderProfile()
    await waitForProfileLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Seguridad' }))
    expect(screen.getByRole('heading', { name: 'Seguridad de la cuenta' })).toBeVisible()
    expect(screen.getByRole('link', { name: /cambiar contraseña/i })).toHaveAttribute(
      'href',
      'http://localhost:4000/auth/account/password',
    )
    expect(await screen.findByRole('link', { name: /configurar 2fa/i })).toHaveAttribute(
      'href',
      'http://localhost:4000/auth/account/2fa',
    )
  })

  it('pide código OTP y mantiene recuperación por correo para desactivar 2FA', async () => {
    mockedApi
      .mockResolvedValueOnce({ ...baseMe })
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
    renderProfile()

    await waitForProfileLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Seguridad' }))
    await screen.findByText('Activada')
    fireEvent.click(screen.getByText('Desactivar verificación en dos pasos'))
    await screen.findByLabelText(/código de 2fa/i)
    fireEvent.click(screen.getByRole('button', { name: /desactivar por correo/i }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/account/2fa/disable-email', expect.objectContaining({ method: 'POST' })),
    )
    expect(await screen.findByText(/te enviamos un correo/i)).toBeInTheDocument()

    const codeInput = await screen.findByLabelText(/código de 2fa/i)
    fireEvent.change(codeInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /desactivar 2fa/i }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/account/2fa/disable', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: '123456' }),
      })),
    )
    expect(await screen.findByText('2FA desactivado')).toBeInTheDocument()
  })

  it('muestra el aviso y limpia los params de la URL tras desactivar 2FA', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/profile?twoFactorDisabled=1' },
    })
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: true })
    renderProfile()

    expect(await screen.findByText('2FA desactivado')).toBeInTheDocument()
    // El param se elimina para que un refresh/atrás no re-dispare el aviso.
    expect(replaceState).toHaveBeenCalledWith(null, '', '/profile')
    replaceState.mockRestore()
  })

  it('muestra el formulario de entrada y carga notificaciones al abrir su sección', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: false })
    renderProfile()
    await waitForProfileLoaded()
    expect(screen.getByRole('button', { name: 'Datos personales' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Datos personales' })).toBeVisible()
    expect(screen.queryByRole('link', { name: /cambiar contraseña/i })).not.toBeInTheDocument()
    expect(vi.mocked(WebPushSection)).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }))
    expect(screen.getByText('Preferencias del navegador')).toBeVisible()
    expect(screen.queryByRole('button', { name: /guardar cambios/i })).not.toBeInTheDocument()
    expect(vi.mocked(WebPushSection)).toHaveBeenCalled()
  })

  it('conserva los cambios del formulario al pasar por otras secciones', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: false })
    renderProfile()
    await waitForProfileLoaded()
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Nuevo nombre' } })
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'nuevo@school.edu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Seguridad' }))
    fireEvent.click(screen.getByRole('button', { name: 'Datos personales' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('Nuevo nombre')
    expect(screen.getByLabelText('Correo')).toHaveValue('nuevo@school.edu')
    expect(mockedApi).not.toHaveBeenCalledWith('/auth/profile', expect.anything())
  })

  it('muestra usuario y cédula como información para un docente y no los envía al guardar', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce({}).mockResolvedValueOnce({ ...baseMe })
    renderProfile()
    await waitForProfileLoaded()
    expect(screen.getByText(baseMe.username)).not.toBeVisible()
    fireEvent.click(screen.getByText('Identificación de la cuenta'))
    expect(screen.getByText(baseMe.username)).toBeVisible()
    expect(screen.getByText(baseMe.nationalId)).toBeVisible()
    expect(screen.queryByLabelText('Cédula')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await screen.findByText('Perfil actualizado')
    const update = mockedApi.mock.calls.find(([url]) => url === '/auth/profile')
    const body = JSON.parse(String(update?.[1]?.body))
    expect(body).not.toHaveProperty('nationalId')
    expect(body).not.toHaveProperty('username')
    expect(body.phone).toBe('+59899123456')
    expect(body.birthdate).toBe('1990-05-10T00:00:00.000Z')
  })

  it('permite a administración editar la cédula desde identificación', async () => {
    const admin = { ...baseMe, role: 'ADMIN', nationalId: '1.234.567-2' }
    mockedApi.mockResolvedValueOnce(admin).mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce({}).mockResolvedValueOnce(admin)
    renderProfile()
    await waitForProfileLoaded()
    fireEvent.click(screen.getByText('Identificación de la cuenta'))
    const ci = screen.getByLabelText('Cédula')
    expect(ci).toBeEnabled()
    fireEvent.change(ci, { target: { value: '12345672' } })
    expect(ci).toHaveValue('1.234.567-2')
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    await screen.findByText('Perfil actualizado')
    expect(mockedApi).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ body: expect.stringContaining('"nationalId":"1.234.567-2"') }))
  })

  it('muestra un error de guardado y conserva el borrador para reintentar', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: false })
      .mockRejectedValueOnce(new Error('409 conflict'))
    renderProfile()
    await waitForProfileLoaded()
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'nuevo@school.edu' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ya registrados')
    expect(screen.getByLabelText('Correo')).toHaveValue('nuevo@school.edu')
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeEnabled()
  })

  it('deja la desactivación desplegable y muestra los códigos de respaldo si 2FA está activo', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: true })
    renderProfile()
    await waitForProfileLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Seguridad' }))
    const recovery = await screen.findByRole('link', { name: 'Códigos de respaldo' })
    expect(recovery).toHaveAttribute('href', 'http://localhost:4000/auth/account/recovery-codes')
    expect(screen.getByRole('button', { name: 'Desactivar 2FA' })).not.toBeVisible()
    fireEvent.click(screen.getByText('Desactivar verificación en dos pasos'))
    expect(screen.getByRole('button', { name: 'Desactivar 2FA' })).toBeDisabled()
  })

  it('no confunde un error de estado 2FA con una cuenta sin protección', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ enabled: true })
    renderProfile()
    await waitForProfileLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Seguridad' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar')
    expect(screen.queryByRole('link', { name: /configurar 2fa/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Activada')).toBeVisible()
  })

  it('un código rechazado conserva 2FA activo y permite reintentar', async () => {
    mockedApi.mockResolvedValueOnce({ ...baseMe }).mockResolvedValueOnce({ enabled: true })
      .mockRejectedValueOnce(new Error('Código incorrecto'))
    renderProfile()
    await waitForProfileLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Seguridad' }))
    await screen.findByText('Activada')
    fireEvent.click(screen.getByText('Desactivar verificación en dos pasos'))
    fireEvent.change(screen.getByLabelText('Código de 2FA'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar 2FA' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorrecto')
    expect(screen.getByText('Activada')).toBeVisible()
    expect(screen.getByLabelText('Código de 2FA')).toHaveValue('123456')
  })

})
