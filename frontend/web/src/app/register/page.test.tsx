import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterPage from './page'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
vi.mock('@/components/PhoneBirthdateFields', () => ({
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
vi.mock('@/lib/image-upload', () => ({
  compressImage: vi.fn(async (f: File) => f),
  fileToDataUrl: vi.fn(async () => 'data:image/png;base64,xx'),
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
    mockedApi.mockResolvedValueOnce({ email: 'x' })

    render(<RegisterPage />)

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/'))
  })

  it('muestra formulario si no hay sesión', async () => {
    mockedApi.mockRejectedValueOnce(new Error('401'))

    render(<RegisterPage />)

    expect(await screen.findByText('Crear Cuenta')).toBeInTheDocument()
  })

  it('muestra error de validación al enviar vacío', async () => {
    mockedApi.mockRejectedValueOnce(new Error('401'))
    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')
    fireEvent.submit(document.querySelector('form') as HTMLFormElement)
    expect(await screen.findByText(/Email inválido/i)).toBeInTheDocument()
  })

  it('registro exitoso tras verificar DNI', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/me')) throw new Error('401')
      if (String(url).includes('check-username')) return { available: true, valid: true }
      if (String(url).includes('verify-step-by-step')) {
        return {
          success: true,
          verifiedFields: 5,
          totalFields: 5,
          verification: {
            firstName: { message: '✓ OK' },
            lastName: { message: '✓ OK' },
            nationalId: { message: '✓ OK' },
            birthdate: { message: '✓ OK' },
            nationalIdDocumentExpiresAt: { message: '✓ OK' },
          },
        }
      }
      if (String(url).includes('/auth/register') && init?.method === 'POST') {
        return { id: 'new-user' }
      }
      return {}
    })

    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')

    fireEvent.change(screen.getByPlaceholderText('tu@email.com'), { target: { value: 'nuevo@mail.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mín 8, Aa y 0-9'), { target: { value: 'Abcd1234!' } })
    fireEvent.change(screen.getByPlaceholderText('Repite tu contraseña'), { target: { value: 'Abcd1234!' } })

    fireEvent.change(screen.getByPlaceholderText('Tus nombres'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByPlaceholderText('Tus apellidos'), { target: { value: 'García' } })
    fireEvent.change(screen.getByPlaceholderText('X.XXX.XXX-X'), { target: { value: '41234563' } })
    fireEvent.change(screen.getByTestId('birthdate-input'), { target: { value: '1990-06-15' } })
    fireEvent.change(screen.getByLabelText(/Vencimiento del DNI/i), { target: { value: '2030-06-01' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'STAFF' } })

    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[0]).includes('check-username'))).toBe(true),
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'dni.png', { type: 'image/png' })] },
    })

    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[0]).includes('verify-step-by-step'))).toBe(true),
    )

    await waitFor(() => expect(screen.getByRole('button', { name: /Crear cuenta/i })).not.toBeDisabled(), {
      timeout: 4000,
    })

    await new Promise((r) => setTimeout(r, 500))
    fireEvent.click(screen.getByRole('button', { name: /Crear cuenta/i }))

    expect(await screen.findByText('Registro Exitoso')).toBeInTheDocument()
    expect(mockedApi.mock.calls.some((c) => String(c[0]).includes('/auth/register'))).toBe(true)
  })

  it('409 en registro muestra mensaje del backend', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/me')) throw new Error('401')
      if (String(url).includes('check-username')) return { available: true, valid: true }
      if (String(url).includes('verify-step-by-step')) {
        return {
          success: true,
          verifiedFields: 5,
          totalFields: 5,
          verification: {
            firstName: { message: '✓' },
            lastName: { message: '✓' },
            nationalId: { message: '✓' },
            birthdate: { message: '✓' },
            nationalIdDocumentExpiresAt: { message: '✓' },
          },
        }
      }
      if (String(url).includes('/auth/register')) {
        throw Object.assign(new Error('Email ya registrado'), {
          status: 409,
          data: { message: 'Email ya registrado' },
        })
      }
      return {}
    })

    render(<RegisterPage />)
    await screen.findByText('Crear Cuenta')
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'), { target: { value: 'dup@mail.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mín 8, Aa y 0-9'), { target: { value: 'Abcd1234!' } })
    fireEvent.change(screen.getByPlaceholderText('Repite tu contraseña'), { target: { value: 'Abcd1234!' } })
    fireEvent.change(screen.getByPlaceholderText('Tus nombres'), { target: { value: 'Pepe' } })
    fireEvent.change(screen.getByPlaceholderText('Tus apellidos'), { target: { value: 'López' } })
    fireEvent.change(screen.getByPlaceholderText('X.XXX.XXX-X'), { target: { value: '41234563' } })
    fireEvent.change(screen.getByTestId('birthdate-input'), { target: { value: '1992-01-01' } })
    fireEvent.change(screen.getByLabelText(/Vencimiento del DNI/i), { target: { value: '2031-01-01' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TEACHER' } })

    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[0]).includes('check-username'))).toBe(true),
    )

    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'd.png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[0]).includes('verify-step-by-step'))).toBe(true),
    )
    await new Promise((r) => setTimeout(r, 500))
    fireEvent.click(screen.getByRole('button', { name: /Crear cuenta/i }))

    expect(await screen.findByText('Email ya registrado')).toBeInTheDocument()
  })
})
