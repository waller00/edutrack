import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUsersPage from './page'
import { api } from '@/lib/api'

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))

const mockedApi = vi.mocked(api)

const row = {
  id: 'u1',
  email: 'e@test.com',
  username: 'user1',
  role: 'TEACHER' as const,
  firstName: 'Ana',
  lastName: 'L',
  isApproved: true,
  isActive: true,
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carga y muestra usuarios', async () => {
    mockedApi.mockResolvedValueOnce({ total: 1, data: [row] })

    render(<AdminUsersPage />)

    expect(await screen.findByText('e@test.com')).toBeInTheDocument()
    expect(screen.getByText('Verificado')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/admin/users?'))
  })

  it('filtrar actualiza query', async () => {
    mockedApi
      .mockResolvedValueOnce({ total: 0, data: [] })
      .mockResolvedValueOnce({ total: 0, data: [] })

    render(<AdminUsersPage />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalled())

    fireEvent.change(screen.getByPlaceholderText(/Buscar/), { target: { value: 'ana' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ADMIN' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }))

    await waitFor(() => {
      expect(mockedApi).toHaveBeenLastCalledWith(expect.stringContaining('q=ana'))
      expect(mockedApi).toHaveBeenLastCalledWith(expect.stringContaining('role=ADMIN'))
    })
  })

  it('abre edición y guarda', async () => {
    mockedApi
      .mockResolvedValueOnce({ total: 1, data: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ total: 1, data: [{ ...row, username: 'newname' }] })

    render(<AdminUsersPage />)
    await screen.findByText('e@test.com')

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(await screen.findByText('Editar usuario')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('user1'), { target: { value: 'newname' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.any(Object)))
  })

  it('error al guardar', async () => {
    mockedApi
      .mockResolvedValueOnce({ total: 1, data: [row] })
      .mockRejectedValueOnce({ message: '409 conflict' })

    render(<AdminUsersPage />)
    await screen.findByText('e@test.com')
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/registrados/)).toBeInTheDocument()
  })

  it('bloqueo y reset password', async () => {
    const alertMock = vi.fn()
    vi.stubGlobal('alert', alertMock)
    mockedApi
      .mockResolvedValueOnce({ total: 1, data: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ total: 1, data: [row] })
      .mockResolvedValueOnce({ token: 'tok', expiresAt: '2026-01-01' })

    render(<AdminUsersPage />)
    await screen.findByText('e@test.com')

    fireEvent.click(screen.getByTitle('Bloquear'))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/lock'), expect.any(Object)))

    fireEvent.click(screen.getByTitle('Resetear contraseña'))
    await waitFor(() => expect(alertMock).toHaveBeenCalled())
  })

  it('toggle aprobación llama API', async () => {
    mockedApi
      .mockResolvedValueOnce({ total: 1, data: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ total: 1, data: [{ ...row, isApproved: false }] })

    render(<AdminUsersPage />)
    await screen.findByText('e@test.com')

    fireEvent.click(screen.getByTitle('Volver a pendiente'))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.objectContaining({ method: 'PUT' })),
    )
  })
})
