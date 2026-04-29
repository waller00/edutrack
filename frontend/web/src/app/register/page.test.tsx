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
})
