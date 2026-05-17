import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminUsersPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))

const mockedApi = vi.mocked(api)

const orgRoles = [
  { code: 'TEACHER', label: 'Docente', active: true },
  { code: 'STAFF', label: 'Administrativo', active: true },
]

const row = {
  id: 'u1',
  email: 'e@test.com',
  username: 'user1',
  role: 'TEACHER',
  firstName: 'Ana',
  lastName: 'L',
  emailVerifiedAt: '2024-06-01T00:00:00.000Z',
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

  it('carga roles y usuarios', async () => {
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })

    render(<AdminUsersPage />)

    expect(await screen.findByText('user1')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(table).toHaveTextContent('Verificado')
    expect(mockedApi).toHaveBeenCalledWith('/admin/org-roles')
    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/admin/users?'))
  })

  it('aplicar filtros actualiza query', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 0, page: 1, pageSize: 20, data: [] })
      .mockResolvedValueOnce({ total: 0, page: 1, pageSize: 20, data: [] })

    render(<AdminUsersPage />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))

    fireEvent.change(screen.getByLabelText('Búsqueda'), { target: { value: 'ana' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'STAFF' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))

    await waitFor(() => {
      const last = mockedApi.mock.calls[mockedApi.mock.calls.length - 1]?.[0] as string
      expect(last).toContain('q=ana')
      expect(last).toContain('role=STAFF')
    })
  })

  it('abre edición y guarda', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [{ ...row, username: 'newname' }] })

    render(<AdminUsersPage />)
    await screen.findByText('user1')

    fireEvent.click(screen.getByRole('button', { name: 'Editar usuario' }))
    expect(await screen.findByRole('heading', { name: 'Editar usuario' })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('user1'), { target: { value: 'newname' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.any(Object)))
  })

  it('error al guardar', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockRejectedValueOnce({ message: '409 conflict' })

    render(<AdminUsersPage />)
    await screen.findByText('user1')
    fireEvent.click(screen.getByRole('button', { name: 'Editar usuario' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText(/registrados/i)).toBeInTheDocument()
  })

  it('bloqueo llama API', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })

    render(<AdminUsersPage />)
    await screen.findByText('user1')

    fireEvent.click(screen.getByRole('button', { name: 'Bloquear 15 min' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/lock'), expect.any(Object)))
  })

  it('toggle aprobación llama API', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [{ ...row, isApproved: false }] })

    render(<AdminUsersPage />)
    await screen.findByText('user1')

    fireEvent.click(screen.getByTitle('Volver a pendiente'))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.objectContaining({ method: 'PUT' })),
    )
  })
})
