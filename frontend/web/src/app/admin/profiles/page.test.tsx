import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminProfilesPanel from '@/components/admin/AdminProfilesPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))

const mockedApi = vi.mocked(api)

const response = {
  permissionCatalog: [
    {
      id: 'attendance.read',
      module: 'Asistencias',
      action: 'read',
      label: 'Ver mis asistencias',
      source: 'system',
    },
    {
      id: 'reportes.read',
      module: 'Reportes',
      action: 'read',
      label: 'Ver reportes internos',
      source: 'custom',
    },
  ],
  roles: [
    {
      role: 'TEACHER',
      label: 'Docente',
      permissions: [
        {
          id: 'attendance.read',
          module: 'Asistencias',
          action: 'read',
          label: 'Ver mis asistencias',
          enabled: true,
          scope: 'own',
          source: 'system',
        },
        {
          id: 'reportes.read',
          module: 'Reportes',
          action: 'read',
          label: 'Ver reportes internos',
          enabled: true,
          scope: 'own',
          source: 'custom',
        },
      ],
    },
    {
      role: 'STAFF',
      label: 'Staff',
      permissions: [],
    },
    {
      role: 'ADMIN',
      label: 'Administrador',
      permissions: [],
    },
  ],
}

const orgRoles = [
  { code: 'TEACHER', label: 'Docente', builtIn: true, active: true },
  { code: 'STAFF', label: 'Staff', builtIn: true, active: true },
  { code: 'ADMIN', label: 'Administrador', builtIn: true, active: true },
]

/** Resuelve la API por URL/método (loadProfiles dispara /admin/profiles + /admin/org-roles). */
function mockApiByUrl() {
  mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    if (u === '/admin/org-roles' && method === 'GET') return orgRoles as never
    if (u === '/admin/profiles' && method === 'GET') return response as never
    if (u.includes('/permissions') && method === 'PUT') return response as never
    if (u === '/admin/profiles' && method === 'POST') return response as never
    return {} as never
  })
}

describe('AdminProfilesPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockApiByUrl()
  })

  it('carga roles y permisos por módulo', async () => {
    render(<AdminProfilesPanel />)

    expect(await screen.findByText('Roles / Perfiles')).toBeInTheDocument()
    expect(screen.getAllByText('Docente').length).toBeGreaterThan(0)
    expect(screen.getByText('Asistencias')).toBeInTheDocument()
    expect(screen.getByText('Ver mis asistencias')).not.toBeVisible()
    fireEvent.click(screen.getByText('Asistencias'))
    expect(screen.getByText('Ver mis asistencias')).toBeVisible()
    expect(
      screen.getAllByText(/2 permisos habilitados/).length,
    ).toBeGreaterThan(0)
  })

  it('marca un permiso y guarda el perfil', async () => {
    render(<AdminProfilesPanel />)
    fireEvent.click(await screen.findByText('Reportes'))
    const checkbox = screen.getByRole('checkbox', {
      name: 'Activar reportes.read',
    })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /^Guardar cambios$/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles/TEACHER/permissions',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    expect(await screen.findByText('Perfil guardado.')).toBeInTheDocument()
  })

  it('el botón Guardar está deshabilitado sin cambios', async () => {
    render(<AdminProfilesPanel />)
    await screen.findByText('Roles / Perfiles')
    expect(
      screen.getByRole('button', { name: /^Guardar cambios$/ }),
    ).toBeDisabled()
  })

  it('activa todo un módulo con el toggle del encabezado', async () => {
    render(<AdminProfilesPanel />)
    // STAFF arranca sin permisos: activar el módulo Asistencias marca su permiso.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Configurar Staff' }),
    )
    fireEvent.click(screen.getByText('Asistencias'))
    const moduleToggle = await screen.findByRole('checkbox', {
      name: 'Activar todo el módulo Asistencias',
    })
    fireEvent.click(moduleToggle)
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Activar attendance.read',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true)
  })

  it('crea un perfil nuevo', async () => {
    render(<AdminProfilesPanel />)
    await screen.findAllByText('Docente')

    fireEvent.click(screen.getByRole('button', { name: /Nuevo perfil/ }))
    fireEvent.change(screen.getByPlaceholderText('Ej: Coordinador'), {
      target: { value: 'Coordinador' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Crear perfil$/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    expect(await screen.findByText(/Perfil creado\./)).toBeInTheDocument()
  })

  it('renombra un perfil personalizado', async () => {
    // El rol seleccionado por defecto es TEACHER (builtIn); agregamos un custom para renombrar.
    mockedApi.mockReset()
    const withCustom = {
      ...response,
      roles: [
        ...response.roles,
        { role: 'COORDINADOR', label: 'Coordinador', permissions: [] },
      ],
    }
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (u === '/admin/org-roles')
        return [
          ...orgRoles,
          {
            code: 'COORDINADOR',
            label: 'Coordinador',
            builtIn: false,
            active: true,
          },
        ] as never
      if (u === '/admin/profiles' && method === 'GET')
        return withCustom as never
      if (u === '/admin/org-roles/COORDINADOR' && method === 'PATCH')
        return {} as never
      return {} as never
    })

    render(<AdminProfilesPanel />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Configurar Coordinador' }),
    )
    fireEvent.click(screen.getByText('Opciones del perfil'))
    const renameInput = await screen.findByLabelText('Nuevo nombre del perfil')
    fireEvent.change(renameInput, { target: { value: 'Coordinación' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/org-roles/COORDINADOR',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('Coordinación'),
        }),
      ),
    )
  })

  it('no permite eliminar perfiles del sistema', async () => {
    render(<AdminProfilesPanel />)
    await screen.findByText('Roles / Perfiles')
    fireEvent.click(screen.getByText('Opciones del perfil'))
    expect(
      screen.queryByRole('button', { name: /Eliminar perfil/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Desactivar perfil/ }),
    ).not.toBeInTheDocument()
  })

  it('no ofrece renombrar un perfil del sistema: el arranque le vuelve a poner su nombre', async () => {
    render(<AdminProfilesPanel />)
    await screen.findByText('Roles / Perfiles')
    fireEvent.click(screen.getByText('Opciones del perfil'))
    expect(
      screen.queryByLabelText('Nuevo nombre del perfil'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/no se renombran, desactivan ni eliminan/),
    ).toBeInTheDocument()
  })

  it('un permiso fijo se ve con su motivo, no se puede cambiar y no viaja al guardar', async () => {
    const withLocks = {
      ...response,
      roles: response.roles.map((role) =>
        role.role === 'ADMIN'
          ? {
              ...role,
              locks: {
                'attendance.read': {
                  enabled: true,
                  scope: 'all',
                  reason: 'Administración ve todo.',
                },
              },
            }
          : role,
      ),
    }
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/admin/org-roles') return orgRoles as never
      if (url === '/admin/profiles' && method === 'GET') return withLocks as never
      if (String(url).includes('/permissions') && method === 'PUT')
        return withLocks as never
      return {} as never
    })

    render(<AdminProfilesPanel />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Configurar Administrador' }),
    )
    fireEvent.click(screen.getByText('Asistencias'))
    const locked = screen.getByRole('checkbox', {
      name: 'Activar attendance.read',
    })
    expect(locked).toBeChecked()
    expect(locked).toBeDisabled()
    expect(
      screen.getByText('Fijado por el sistema: Administración ve todo.'),
    ).toBeVisible()
    // Con todo lo editable del módulo fijo, no hay "Activar todo el módulo".
    expect(
      screen.queryByRole('checkbox', {
        name: 'Activar todo el módulo Asistencias',
      }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Reportes'))
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles/ADMIN/permissions',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    const put = mockedApi.mock.calls.find(
      ([url, init]) =>
        url === '/admin/profiles/ADMIN/permissions' && init?.method === 'PUT',
    )
    const sent = JSON.parse(String(put?.[1]?.body)).permissions as {
      id: string
    }[]
    expect(sent.map((item) => item.id)).toEqual(['reportes.read'])
  })

  it('busca perfiles y permite limpiar una búsqueda sin resultados', async () => {
    render(<AdminProfilesPanel />)
    await screen.findByRole('button', { name: 'Configurar Docente' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar perfil' }), {
      target: { value: 'teacher' },
    })
    expect(
      screen.getByRole('button', { name: 'Configurar Docente' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Configurar Staff' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar perfil' }), {
      target: { value: 'inexistente' },
    })
    expect(
      screen.getByText('No hay perfiles que coincidan con los filtros.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(
      screen.getByRole('button', { name: 'Configurar Staff' }),
    ).toBeInTheDocument()
  })

  it('encuentra permisos por nombre o código sin cambiar permisos ocultos', async () => {
    render(<AdminProfilesPanel />)
    await screen.findByText('Asistencias')
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Buscar permiso' }),
      { target: { value: 'REPORTES.READ' } },
    )
    expect(screen.queryByText('Asistencias')).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('checkbox', { name: /Activar todo el módulo/ }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles/TEACHER/permissions',
        expect.objectContaining({
          body: JSON.stringify({
            permissions: [
              {
                id: 'attendance.read',
                enabled: true,
                scope: 'own',
                label: 'Ver mis asistencias',
              },
              {
                id: 'reportes.read',
                enabled: false,
                scope: 'own',
                label: 'Ver reportes internos',
              },
            ],
          }),
        }),
      ),
    )
  })

  it('muestra un resumen de accesos y conserva el alcance al guardar', async () => {
    render(<AdminProfilesPanel />)
    fireEvent.click(await screen.findByText('Asistencias'))
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Alcance de attendance.read' }),
      { target: { value: 'all' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resumen de accesos' }))
    expect(
      screen.getByText(
        'Este resumen incluye cambios que todavía no se guardaron.',
        { exact: false },
      ),
    ).toBeVisible()
    expect(screen.getByText('Todos los registros')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles/TEACHER/permissions',
        expect.objectContaining({
          body: expect.stringContaining('"scope":"all"'),
        }),
      ),
    )
  })

  it('conserva el borrador de otro perfil después de guardar', async () => {
    render(<AdminProfilesPanel />)
    fireEvent.click(await screen.findByText('Reportes'))
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Configurar Staff' }))
    fireEvent.click(screen.getByText('Asistencias'))
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Activar todo el módulo Asistencias',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await screen.findByText('Perfil guardado.')
    fireEvent.click(screen.getByRole('button', { name: 'Configurar Docente' }))
    fireEvent.click(screen.getByText('Reportes'))
    expect(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Guardar cambios' }),
    ).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer cambios' }))
    expect(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    ).toBeChecked()
  })

  it('personaliza los nombres desde opciones sin perder el resto de permisos', async () => {
    render(<AdminProfilesPanel />)
    fireEvent.click(await screen.findByText('Personalizar nombres de permisos'))
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Editar nombres visibles' }),
    )
    fireEvent.click(screen.getByText('Asistencias'))
    fireEvent.change(
      screen.getByLabelText('Nombre visible de attendance.read'),
      { target: { value: 'Consultar asistencia' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles/TEACHER/permissions',
        expect.objectContaining({
          body: expect.stringContaining('Consultar asistencia'),
        }),
      ),
    )
  })

  it('genera el código a partir del nombre completo al crear un perfil', async () => {
    render(<AdminProfilesPanel />)
    await screen.findByText('Asistencias')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo perfil' }))
    fireEvent.change(screen.getByPlaceholderText('Ej: Coordinador'), {
      target: { value: 'C' },
    })
    fireEvent.change(screen.getByPlaceholderText('Ej: Coordinador'), {
      target: { value: 'Coordinación académica' },
    })
    expect(screen.getByPlaceholderText('COORDINADOR')).toHaveValue(
      'COORDINACION_ACADEMICA',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Crear perfil' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles',
        expect.objectContaining({
          body: expect.stringContaining('"code":"COORDINACION_ACADEMICA"'),
        }),
      ),
    )
  })

  it('lista y reactiva un perfil inactivo que no aparece en la matriz de permisos', async () => {
    let active = false
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/admin/org-roles')
        return [
          ...orgRoles,
          { code: 'COORDINADOR', label: 'Coordinador', builtIn: false, active },
        ] as never
      if (url === '/admin/profiles')
        return {
          ...response,
          roles: active
            ? [
                ...response.roles,
                {
                  ...response.roles[0],
                  role: 'COORDINADOR',
                  label: 'Coordinador',
                },
              ]
            : response.roles,
        } as never
      if (url === '/admin/org-roles/COORDINADOR' && init?.method === 'PATCH') {
        active = true
        return {} as never
      }
      return {} as never
    })
    render(<AdminProfilesPanel />)
    await screen.findByRole('button', { name: 'Configurar Coordinador' })
    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }))
    expect(
      screen.queryByRole('button', { name: 'Configurar Docente' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Configurar Coordinador' }),
    )
    expect(
      screen.queryByRole('button', { name: 'Guardar cambios' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Opciones del perfil'))
    fireEvent.click(screen.getByRole('button', { name: 'Activar perfil' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/org-roles/COORDINADOR', {
        method: 'PATCH',
        body: '{"active":true}',
      }),
    )
    await screen.findByText('Perfil activado.')
    fireEvent.click(screen.getByText('Asistencias'))
    expect(
      screen.getByRole('checkbox', { name: 'Activar attendance.read' }),
    ).toBeChecked()
  })

  it('muestra errores de guardado y conserva los cambios para reintentar', async () => {
    mockApiByUrl()
    const base = mockedApi.getMockImplementation()!
    mockedApi.mockImplementation(async (url, init) => {
      if (init?.method === 'PUT') throw new Error('No se pudo guardar')
      return base(url, init)
    })
    render(<AdminProfilesPanel />)
    fireEvent.click(await screen.findByText('Reportes'))
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo guardar',
    )
    expect(
      screen.getByRole('checkbox', { name: 'Activar reportes.read' }),
    ).not.toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Guardar cambios' }),
    ).toBeEnabled()
  })

  it('permite reintentar la carga sin presentar un estado vacío como éxito', async () => {
    mockedApi.mockRejectedValue(new Error('Sin conexión'))
    render(<AdminProfilesPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión')
    expect(
      screen.queryByText('Todavía no hay perfiles.'),
    ).not.toBeInTheDocument()
    mockApiByUrl()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(
      await screen.findByRole('button', { name: 'Configurar Docente' }),
    ).toBeInTheDocument()
  })
})
