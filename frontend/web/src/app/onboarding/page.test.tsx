import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPage from './page'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
vi.mock('@/lib/image-upload', () => ({
  compressImage: vi.fn(async (f: File) => f),
  fileToDataUrl: vi.fn(async () => 'data:image/png;base64,x'),
}))

const mockedApi = vi.mocked(api)

describe('OnboardingPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-dni'),
      revokeObjectURL: vi.fn(),
    })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/onboarding' },
    })
  })

  it('redirige a login si /auth/me falla', async () => {
    mockedApi.mockRejectedValueOnce(new Error('401'))
    render(<OnboardingPage />)
    await waitFor(() => expect(window.location.href).toBe('/login'))
  })

  it('muestra flujo de completar perfil', async () => {
    mockedApi.mockResolvedValueOnce({
      email: 't@test.com',
      role: 'TEACHER',
      hasPassword: true,
      firstName: '',
      lastName: '',
    })

    render(<OnboardingPage />)

    expect(await screen.findByText('Completa tu registro')).toBeInTheDocument()
  })

  it('rechaza archivo que no es imagen en DNI', async () => {
    mockedApi.mockResolvedValueOnce({
      email: 'a@a.com',
      role: 'STAFF',
      hasPassword: true,
      username: 'user.ab',
      firstName: 'Ana',
      lastName: 'B',
      nationalId: '41234563',
      birthdate: '1990-01-01',
    })
    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] },
    })
    expect(await screen.findByText(/Selecciona una imagen válida/i)).toBeInTheDocument()
  })

  it('guarda perfil tras verificar DNI', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/me')) {
        return {
          email: 'g@g.com',
          role: 'STAFF',
          hasPassword: true,
          username: 'ana.garcia',
          firstName: 'Ana',
          lastName: 'García',
          nationalId: '41234563',
          birthdate: '1995-03-15T00:00:00.000Z',
        }
      }
      if (String(url).includes('verify-step-by-step')) {
        return {
          success: true,
          verification: {
            firstName: { provided: 'Ana', message: '✓ Coincide' },
            lastName: { provided: 'García', message: '✓ Coincide' },
            nationalId: { provided: '4.123.456-3', message: '✓ Coincide' },
            birthdate: { provided: '1995-03-15', message: '✓ Coincide' },
          },
        }
      }
      if (String(url).includes('/auth/profile') && init?.method === 'PUT') return {}
      return {}
    })

    render(<OnboardingPage />)
    await screen.findByText('Completa tu registro')

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['xx'], 'dni.png', { type: 'image/png' })] },
    })

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/auth/verify-step-by-step',
        expect.objectContaining({ method: 'POST' }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/auth/profile', expect.objectContaining({ method: 'PUT' })),
    )
    expect(window.location.href).toBe('/')
  })

  it('muestra error 409 al guardar perfil duplicado', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/me')) {
        return {
          email: 'g@g.com',
          role: 'STAFF',
          hasPassword: true,
          username: 'ana.garcia',
          firstName: 'Ana',
          lastName: 'García',
          nationalId: '41234563',
          birthdate: '1995-03-15T00:00:00.000Z',
        }
      }
      if (String(url).includes('verify-step-by-step')) {
        return {
          success: true,
          verification: {
            firstName: { provided: 'Ana', message: '✓ OK' },
            lastName: { provided: 'G', message: '✓ OK' },
            nationalId: { provided: 'x', message: '✓ OK' },
            birthdate: { provided: 'x', message: '✓ OK' },
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
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'd.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('verify-step-by-step'), expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: /Guardar y enviar a validación/ }))
    expect(await screen.findByText(/Usuario o cédula ya registrados/i)).toBeInTheDocument()
  })
})
