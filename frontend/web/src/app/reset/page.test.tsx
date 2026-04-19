import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResetPage from './page'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

describe('ResetPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/reset?token=abc123')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('validates password length', async () => {
    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    expect(await screen.findByText('La contraseña debe tener al menos 8 caracteres')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('validates password confirmation', async () => {
    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: '87654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('submits the reset token y redirige al inicio (sesión como login)', async () => {
    let hrefTarget = ''
    const stub = {
      ancestorOrigins: [] as unknown as DOMStringList,
      hash: '',
      host: 'localhost',
      hostname: 'localhost',
      href: '',
      origin: 'http://localhost:3000',
      pathname: '/reset',
      port: '3000',
      protocol: 'http:',
      search: '?token=abc123',
      assign: vi.fn(),
      reload: vi.fn(),
      replace: vi.fn(),
      set href(v: string) {
        hrefTarget = v
      },
      get href() {
        return hrefTarget || 'http://localhost:3000/reset?token=abc123'
      },
    } as Location
    vi.stubGlobal('location', stub)

    vi.mocked(api).mockResolvedValueOnce({
      id: '1',
      email: 'a@b.com',
      name: 'N',
      role: 'TEACHER',
    })

    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ token: 'abc123', password: '12345678' }),
      })
    )
    await waitFor(() => expect(hrefTarget).toBe('/'))
  })

  it('shows an invalid-link error when the reset request fails', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('expired'))

    render(<ResetPage />)

    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar contraseña' }))

    expect(await screen.findByText('El enlace es inválido o expiró')).toBeInTheDocument()
  })
})
