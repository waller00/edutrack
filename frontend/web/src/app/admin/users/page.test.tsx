import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

    expect((await screen.findAllByText('user1')).length).toBeGreaterThan(0)
    const table = screen.getByRole('table')
    expect(table).toHaveTextContent('Verificado')
    expect(mockedApi).toHaveBeenCalledWith('/admin/org-roles')
    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/admin/users?'))
  })

  it('marca en verde el botón cuando el usuario tiene huella vinculada', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [{ ...row, biometricLinked: true }] })

    render(<AdminUsersPage />)

    await screen.findAllByText('user1')
    const button = within(screen.getByRole('table')).getByRole('button', { name: 'Huella vinculada' })
    expect(button).toHaveClass('bg-emerald-600')
    expect(button).toHaveClass('text-white')
    expect(button).toHaveClass('shrink-0')
    expect(button).toHaveClass('h-9')
    expect(button).toHaveClass('w-9')
  })

  it('muestra botón de huella reconocible sin vincular', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [{ ...row, biometricLinked: false }] })

    render(<AdminUsersPage />)

    await screen.findAllByText('user1')
    const button = within(screen.getByRole('table')).getByRole('button', { name: 'Vincular huella' })
    expect(button).toHaveClass('bg-amber-50')
    expect(button).toHaveClass('text-amber-700')
    expect(button).not.toHaveClass('bg-emerald-600')
    expect(button).toHaveClass('h-9')
    expect(button).toHaveClass('w-9')
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
    await screen.findAllByText('user1')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Editar usuario' }))
    expect(await screen.findByRole('heading', { name: 'Editar usuario' })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('user1'), { target: { value: 'newname' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.any(Object)))
  })

  it('no guarda edición con usuario inválido', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Editar usuario' }))
    fireEvent.change(screen.getByDisplayValue('user1'), { target: { value: 'no valido!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByText(/Usuario inválido/i)).toBeInTheDocument()
    expect(mockedApi).not.toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.any(Object))
  })

  it('error al guardar', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockRejectedValueOnce({ message: '409 conflict' })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Editar usuario' }))
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
    await screen.findAllByText('user1')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Bloquear 15 min' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/lock'), expect.any(Object)))
  })

  it('toggle aprobación llama API', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [{ ...row, isApproved: false }] })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(within(screen.getByRole('table')).getByTitle('Volver a pendiente'))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.objectContaining({ method: 'PUT' })),
    )
  })

  it('chip "Pendientes de aprobación" aplica el filtro approved=false', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({ total: 0, page: 1, pageSize: 20, data: [] })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(screen.getByRole('button', { name: 'Pendientes de aprobación' }))

    await waitFor(() => {
      const last = mockedApi.mock.calls.at(-1)?.[0] as string
      expect(last).toContain('approved=false')
    })
  })

  it('muestra el banner de feedback al restablecer contraseña', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({ ok: true, message: 'Se envió el correo de restablecimiento.' })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Restablecer contraseña' }))

    expect(await screen.findByText(/correo de restablecimiento/i)).toBeInTheDocument()
  })

  it('renderiza las tarjetas mobile además de la tabla', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })

    render(<AdminUsersPage />)

    // username aparece en la fila de tabla y en la tarjeta mobile
    const matches = await screen.findAllByText('user1')
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
