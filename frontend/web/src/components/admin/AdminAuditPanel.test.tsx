import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAuditPanel from './AdminAuditPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const row = {
  id: 'a1',
  occurredAt: '2026-06-15T10:00:00.000Z',
  action: 'AUTH_LOGIN_FAILURE',
  actionLabel: 'Login fallido',
  actorUserId: '11111111-1111-4111-8111-111111111111',
  actorName: 'Ana',
  actorEmail: 'a@b.com',
  actorIp: '1.2.3.4',
  userAgent: null,
  source: 'web',
  entityType: null,
  entityId: null,
  metadata: { reason: 'INVALID_PASSWORD' },
}

const response = {
  total: 1,
  page: 1,
  pageSize: 25,
  actionCatalog: [{ code: 'AUTH_LOGIN_FAILURE', label: 'Login fallido' }],
  data: [row],
}

describe('AdminAuditPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockResolvedValue(response as never)
  })

  it('colorea el badge de acción según el tipo (fallo = rojo)', async () => {
    render(<AdminAuditPanel />)
    const badge = await screen.findByText('Login fallido', { selector: 'span' })
    expect(badge).toHaveClass('bg-red-100')
    expect(screen.getByText('AUTH_LOGIN_FAILURE')).not.toBeVisible()
    expect(screen.getByText('La contraseña no coincide.')).not.toBeVisible()
  })

  it('muestra "Limpiar" al activar un filtro y lo resetea', async () => {
    render(<AdminAuditPanel />)
    await screen.findByText('Login fallido', { selector: 'span' })

    expect(
      screen.queryByRole('button', { name: 'Limpiar filtros' }),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de acción' }), {
      target: { value: 'AUTH_LOGIN_FAILURE' },
    })

    const clear = await screen.findByRole('button', { name: 'Limpiar filtros' })
    fireEvent.click(clear)

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Limpiar filtros' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('abre el detalle legible y mantiene los datos técnicos en un segundo desplegable', async () => {
    render(<AdminAuditPanel />)
    const activity = await screen.findByLabelText(
      /Ver detalle de Login fallido/,
    )
    expect(screen.getByText('1.2.3.4')).toBeVisible()
    fireEvent.click(activity)
    expect(screen.getByText('La contraseña no coincide.')).toBeVisible()
    fireEvent.click(screen.getByText('Datos técnicos'))
    expect(screen.getByText('1.2.3.4')).toBeVisible()
    expect(screen.getByText('AUTH_LOGIN_FAILURE')).toBeVisible()
    expect(screen.getByText('{"reason":"INVALID_PASSWORD"}')).toBeVisible()
  })

  it('filtra fechas por el día completo de Uruguay, incluyendo las últimas horas', async () => {
    render(<AdminAuditPanel />)
    await screen.findByText('Login fallido', { selector: 'span' })
    fireEvent.click(screen.getByRole('button', { name: /Período/ }))
    fireEvent.change(screen.getByLabelText('Fecha inicio'), {
      target: { value: '15/06/2026' },
    })
    fireEvent.change(screen.getByLabelText('Fecha fin'), {
      target: { value: '15/06/2026' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    await waitFor(() => {
      const query = new URL(
        String(mockedApi.mock.calls.at(-1)?.[0]),
        'http://local',
      ).searchParams
      expect(query.get('from')).toBe('2026-06-15T03:00:00.000Z')
      expect(query.get('to')).toBe('2026-06-16T02:59:59.999Z')
    })
  })

  it('filtra por la persona de una actividad y permite quitar solo ese filtro', async () => {
    render(<AdminAuditPanel />)
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Tipo de acción' }),
      { target: { value: 'AUTH_LOGIN_FAILURE' } },
    )
    fireEvent.click(
      await screen.findByLabelText(/Ver detalle de Login fallido/),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver actividad de esta persona' }),
    )
    await waitFor(() =>
      expect(String(mockedApi.mock.calls.at(-1)?.[0])).toContain(
        'actorUserId=' + row.actorUserId,
      ),
    )
    expect(screen.getByText('Actividad de:')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Persona Ana' })).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar filtro de usuario' }),
    )
    await waitFor(() => {
      const query = new URL(
        String(mockedApi.mock.calls.at(-1)?.[0]),
        'http://local',
      ).searchParams
      expect(query.get('actorUserId')).toBeNull()
      expect(query.get('action')).toBe('AUTH_LOGIN_FAILURE')
    })
  })

  it('elige una persona por nombre y correo sin pedir su ID', async () => {
    mockedApi.mockImplementation(async (url) => {
      if (String(url).startsWith('/admin/audit-logs/users?')) {
        return {
          total: 1,
          data: [{ id: row.actorUserId, name: 'Ana', email: 'a@b.com' }],
        } as never
      }
      return response as never
    })
    render(<AdminAuditPanel />)
    await screen.findByText('Login fallido', { selector: 'span' })
    expect(
      screen.queryByLabelText('ID de usuario', { selector: 'input' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Persona Todos los usuarios' }),
    )
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Buscar usuario por nombre o correo',
      }),
      {
        target: { value: 'a@b.com' },
      },
    )
    fireEvent.click(await screen.findByRole('option', { name: 'Ana a@b.com' }))
    await waitFor(() =>
      expect(String(mockedApi.mock.calls.at(-1)?.[0])).toContain(
        'actorUserId=' + row.actorUserId,
      ),
    )
    expect(screen.getByRole('button', { name: 'Persona Ana' })).toBeVisible()
    expect(
      screen.queryByRole('dialog', { name: 'Elegir persona' }),
    ).not.toBeInTheDocument()
    expect(
      mockedApi.mock.calls.some(([url]) => String(url).includes('q=a%40b.com')),
    ).toBe(true)
  })

  it('pagina desde el servidor y vuelve a la primera página al cambiar filtros', async () => {
    mockedApi.mockResolvedValue({ ...response, total: 50 } as never)
    render(<AdminAuditPanel />)
    await screen.findByText('Login fallido', { selector: 'span' })
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await waitFor(() =>
      expect(String(mockedApi.mock.calls.at(-1)?.[0])).toContain('page=2'),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled(),
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de acción' }), {
      target: { value: 'AUTH_LOGIN_FAILURE' },
    })
    await waitFor(() =>
      expect(String(mockedApi.mock.calls.at(-1)?.[0])).toContain('page=1'),
    )
  })

  it('ignora una respuesta anterior que termina después de cambiar filtros', async () => {
    let finishFirst!: (value: unknown) => void
    mockedApi.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        }),
    )
    mockedApi.mockResolvedValue({
      ...response,
      data: [{ ...row, actorName: 'Último resultado' }],
    } as never)
    render(<AdminAuditPanel />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: /Período/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }))
    await screen.findByText('Último resultado', { selector: 'span' })
    await act(async () => {
      finishFirst(response)
    })
    expect(
      screen.getByText('Último resultado', { selector: 'span' }),
    ).toBeVisible()
    expect(
      screen.queryByText('Ana', { selector: 'span' }),
    ).not.toBeInTheDocument()
  })

  it('muestra un error con reintento sin informar que no hay registros', async () => {
    mockedApi.mockRejectedValueOnce(new Error('No se pudo conectar con la API'))
    render(<AdminAuditPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo conectar con la API',
    )
    expect(
      screen.queryByText('Todavía no hay movimientos registrados.'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(
      await screen.findByText('Login fallido', { selector: 'span' }),
    ).toBeVisible()
  })

  it('distingue una lista vacía de una búsqueda sin coincidencias', async () => {
    mockedApi.mockResolvedValue({ ...response, total: 0, data: [] } as never)
    render(<AdminAuditPanel />)
    await screen.findByText('Todavía no hay movimientos registrados.')
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de acción' }), {
      target: { value: 'AUTH_LOGIN_FAILURE' },
    })
    await screen.findByText('No hay movimientos que coincidan con los filtros.')
    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar filtros y ver todos' }),
    )
    await screen.findByText('Todavía no hay movimientos registrados.')
  })

  it('no ofrece filtrar una actividad sin usuario identificado', async () => {
    mockedApi.mockResolvedValue({
      ...response,
      data: [{ ...row, actorUserId: null, actorName: null, actorEmail: null }],
    } as never)
    render(<AdminAuditPanel />)
    fireEvent.click(
      await screen.findByLabelText(/Ver detalle de Login fallido/),
    )
    expect(
      screen.queryByRole('button', { name: 'Ver actividad de esta persona' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByText(/Usuario no identificado/).length,
    ).toBeGreaterThan(0)
  })
})
