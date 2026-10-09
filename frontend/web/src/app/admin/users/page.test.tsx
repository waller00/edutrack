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

function openActions() {
  fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Más acciones de Ana L' }))
  return within(screen.getByRole('dialog', { name: 'Acciones de Ana L' }))
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
    expect(table).toHaveTextContent('Activo')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4)
    expect(mockedApi).toHaveBeenCalledWith('/admin/org-roles')
    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/admin/users?'))
  })

  it('muestra tres botones junto a los resultados, arranca en Todos y conserva el estado al paginar', async () => {
    mockedApi.mockImplementation(async (url) => {
      if (url === '/admin/org-roles') return orgRoles as never
      const params = new URL(String(url), 'http://localhost').searchParams
      return { total: 41, page: Number(params.get('page')), pageSize: 20, data: [row] } as never
    })
    render(<AdminUsersPage />)
    await screen.findAllByText('user1')
    expect(screen.queryByLabelText('Mostrar')).toBeNull()
    const buttons = within(screen.getByRole('group', { name: 'Filtrar usuarios por aprobación' })).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Todos', 'Aprobados', 'Pendientes'])
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20')
    fireEvent.click(buttons[2])
    await waitFor(() => expect(buttons[2]).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=2&pageSize=20&approved=false'))
    fireEvent.click(buttons[0])
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20'))
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'false')
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

  it('rechaza una solicitud pendiente con motivo y avisa que se mandó el correo', async () => {
    const pendingRow = { ...row, isApproved: false }
    const promptMock = vi.fn((_message: string): string | null => '  No trabaja en el liceo  ')
    vi.stubGlobal('prompt', promptMock)
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [pendingRow] })
      .mockResolvedValueOnce({ ok: true, notified: true })
      .mockResolvedValueOnce({ total: 0, page: 1, pageSize: 20, data: [] })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Rechazar solicitud' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'No trabaja en el liceo' }),
      }),
    )
    expect(promptMock.mock.calls[0][0]).toMatch(/Le va a llegar un correo/)
    expect(await screen.findByText(/Se le avisó por correo/)).toBeInTheDocument()
  })

  it('al rechazar sin correo verificado lo aclara y cancelar no hace nada', async () => {
    const unverified = { ...row, isApproved: false, emailVerifiedAt: null }
    const promptMock = vi.fn((_message: string): string | null => null)
    vi.stubGlobal('prompt', promptMock)
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [unverified] })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Rechazar solicitud' }))

    expect(promptMock.mock.calls[0][0]).toMatch(/No se le manda correo/)
    expect(mockedApi).not.toHaveBeenCalledWith(`/admin/users/${row.id}/reject`, expect.any(Object))
  })

  it('no muestra Rechazar a una cuenta aprobada', async () => {
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    expect(openActions().queryByRole('button', { name: 'Rechazar solicitud' })).toBeNull()
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

    fireEvent.click(openActions().getByRole('button', { name: 'Bloquear 15 min' }))
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

    fireEvent.click(openActions().getByRole('button', { name: 'Volver a pendiente' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.objectContaining({ method: 'PUT' })),
    )
  })

  it('los botones separan usuarios aprobados de pendientes sin excluir correos sin verificar', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({ total: 0, page: 1, pageSize: 20, data: [] })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(screen.getByRole('button', { name: 'Pendientes' }))

    await waitFor(() => {
      const last = mockedApi.mock.calls.at(-1)?.[0] as string
      expect(last).toContain('approved=false')
      expect(last).not.toContain('verified=')
    })
  })

  it('no deja aprobar una cuenta que todavía no verificó el correo', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({
        total: 1,
        page: 1,
        pageSize: 20,
        data: [{ ...row, isApproved: false, emailVerifiedAt: null }],
      })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    expect(within(screen.getByRole('table')).queryByRole('button', { name: 'Aprobar' })).toBeNull()
    expect(within(screen.getByRole('table')).getByText('Correo sin verificar')).toBeInTheDocument()
    expect(mockedApi).not.toHaveBeenCalledWith(`/admin/users/${row.id}`, expect.anything())
  })

  it('muestra el banner de feedback al restablecer contraseña', async () => {
    mockedApi
      .mockResolvedValueOnce(orgRoles)
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [row] })
      .mockResolvedValueOnce({ ok: true, message: 'Se envió el correo de restablecimiento.' })

    render(<AdminUsersPage />)
    await screen.findAllByText('user1')

    fireEvent.click(openActions().getByRole('button', { name: 'Restablecer contraseña' }))

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

  it('pliega los filtros secundarios, conserva los aplicados al cerrarlos y permite limpiarlos', async () => {
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValue({ total: 0, page: 1, pageSize: 20, data: [] })
    render(<AdminUsersPage />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))

    const summary = screen.getByText('Más filtros')
    const details = summary.closest('details')!
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(summary)
    expect(details).toHaveAttribute('open')
    fireEvent.change(screen.getByLabelText('Bloqueo temporal'), { target: { value: 'true' } })
    fireEvent.change(screen.getByLabelText('Documento de identidad'), { target: { value: 'true' } })
    expect(mockedApi).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith(expect.stringContaining('locked=true&docExpiring=true')))
    fireEvent.click(screen.getByText('Más filtros · 2 activos'))
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('Más filtros · 2 activos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20'))
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Bloqueo temporal')).toHaveValue('')
    expect(screen.getByLabelText('Documento de identidad')).toHaveValue('')
  })

  it('conserva búsqueda y rol al cambiar de lista y Limpiar mantiene la lista de pendientes', async () => {
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValue({ total: 0, page: 1, pageSize: 20, data: [] })
    render(<AdminUsersPage />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20')
    fireEvent.change(screen.getByLabelText('Búsqueda'), { target: { value: 'ana' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'STAFF' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pendientes' }))
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20&q=ana&role=STAFF&approved=false'))
    fireEvent.click(screen.getByText('Más filtros'))
    fireEvent.change(screen.getByLabelText('Correo verificado'), { target: { value: 'false' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }))
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20&q=ana&role=STAFF&approved=false&verified=false'))
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20&approved=false'))
    expect(screen.getByRole('button', { name: 'Pendientes' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Aprobados' }))
    await waitFor(() => expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20&approved=true'))
  })

  it.each([true, false])('una solicitud pendiente solo ofrece acciones de revisión (correo verificado: %s)', async (verified) => {
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [{ ...row, isApproved: false, isActive: false, emailVerifiedAt: verified ? row.emailVerifiedAt : null }] })
    render(<AdminUsersPage />)
    await screen.findAllByText('user1')
    expect(screen.getAllByRole('button', { name: 'Revisar solicitud' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Rechazar solicitud' })).toHaveLength(2)
    expect(screen.queryAllByRole('button', { name: 'Aprobar' })).toHaveLength(verified ? 2 : 0)
    expect(screen.queryByRole('button', { name: /huella|Más acciones|contraseña|Bloquear|Dar de|Eliminar/ })).toBeNull()
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Revisar solicitud' }))
    expect(screen.getByRole('heading', { name: 'Revisar solicitud' })).toBeInTheDocument()
    expect(screen.queryByText('Estado cuenta')).toBeNull()
    expect(screen.queryByText('Aprobación')).toBeNull()
    expect(mockedApi).toHaveBeenCalledTimes(2)
  })

  it('aprobar retira la solicitud de pendientes y recarga esa misma lista', async () => {
    let approved = false
    mockedApi.mockImplementation(async (url, options) => {
      if (url === '/admin/org-roles') return orgRoles as never
      if (url === '/admin/users/u1' && options?.method === 'PUT') {
        approved = true
        return {} as never
      }
      const showingPending = new URL(String(url), 'http://localhost').searchParams.get('approved') === 'false'
      const data = showingPending && !approved ? [{ ...row, isApproved: false }] : []
      return { total: data.length, page: 1, pageSize: 20, data } as never
    })
    render(<AdminUsersPage />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Pendientes' }))
    await screen.findAllByText('user1')
    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Aprobar' }))
    await waitFor(() => expect(screen.queryAllByText('user1')).toHaveLength(0))
    expect(mockedApi).toHaveBeenCalledWith('/admin/users/u1', { method: 'PUT', body: JSON.stringify({ isApproved: true }) })
    expect(mockedApi).toHaveBeenLastCalledWith('/admin/users?page=1&pageSize=20&approved=false')
    expect(screen.getByRole('button', { name: 'Pendientes' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('el menú cierra con Escape o al hacer clic afuera y no cambia la cuenta', async () => {
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValue({ total: 1, page: 1, pageSize: 20, data: [row] })
    render(<AdminUsersPage />)
    await screen.findAllByText('user1')
    const trigger = within(screen.getByRole('table')).getByRole('button', { name: 'Más acciones de Ana L' })
    const actions = openActions()
    expect(actions.getByRole('button', { name: 'Volver a pendiente' })).toHaveFocus()
    expect(actions.queryByRole('button', { name: 'Eliminar definitivamente' })).toBeNull()
    fireEvent(window, new Event('resize'))
    expect(screen.getByRole('dialog', { name: 'Acciones de Ana L' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    openActions()
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Usuarios' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockedApi).toHaveBeenCalledTimes(2)
  })

  it('mantiene la confirmación de baja y limita la eliminación a cuentas dadas de baja', async () => {
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValue({ total: 1, page: 1, pageSize: 20, data: [row] })
    vi.stubGlobal('confirm', vi.fn(() => false))
    const view = render(<AdminUsersPage />)
    await screen.findAllByText('user1')
    fireEvent.click(openActions().getByRole('button', { name: 'Dar de baja' }))
    expect(confirm).toHaveBeenCalledWith('¿Dar de baja al usuario?')
    expect(mockedApi).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()

    mockedApi.mockReset()
    mockedApi.mockResolvedValueOnce(orgRoles).mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20, data: [{ ...row, isActive: false }] }).mockResolvedValueOnce({}).mockResolvedValueOnce({ total: 0, data: [] })
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<AdminUsersPage />)
    await screen.findAllByText('user1')
    expect(within(screen.getByRole('table')).getByText('De baja')).toBeInTheDocument()
    fireEvent.click(openActions().getByRole('button', { name: 'Eliminar definitivamente' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/users/u1', { method: 'DELETE' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Esta acción no se puede deshacer'))
  })

})
