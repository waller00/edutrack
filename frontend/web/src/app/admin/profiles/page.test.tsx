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

    expect(await screen.findByText('Gestión de perfiles')).toBeInTheDocument()
    expect(screen.getAllByText('Docente').length).toBeGreaterThan(0)
    expect(screen.getByText('Asistencias')).toBeInTheDocument()
    // El label de permiso ahora es un input editable.
    expect(screen.getByDisplayValue('Ver mis asistencias')).toBeInTheDocument()
    expect(screen.getAllByText('2 permisos activos').length).toBeGreaterThan(0)
  })

  it('marca un permiso y guarda el perfil', async () => {
    render(<AdminProfilesPanel />)
    const checkbox = await screen.findByRole('checkbox', { name: 'Activar reportes.read' })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/ }))

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
    await screen.findByText('Gestión de perfiles')
    expect(screen.getByRole('button', { name: /^Guardar$/ })).toBeDisabled()
  })

  it('activa todo un módulo con el toggle del encabezado', async () => {
    render(<AdminProfilesPanel />)
    // STAFF arranca sin permisos: activar el módulo Asistencias marca su permiso.
    fireEvent.change(await screen.findByLabelText('Perfil a configurar'), { target: { value: 'STAFF' } })
    const moduleToggle = await screen.findByRole('checkbox', { name: 'Activar todo el módulo Asistencias' })
    fireEvent.click(moduleToggle)
    expect((screen.getByRole('checkbox', { name: 'Activar attendance.read' }) as HTMLInputElement).checked).toBe(true)
  })

  it('crea un perfil nuevo', async () => {
    render(<AdminProfilesPanel />)
    await screen.findAllByText('Docente')

    fireEvent.click(screen.getByRole('button', { name: /Nuevo perfil/ }))
    fireEvent.change(screen.getByPlaceholderText('Ej: Coordinador'), { target: { value: 'Coordinador' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Guardar$/ })[0])

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/profiles', expect.objectContaining({ method: 'POST' })),
    )
    expect(await screen.findByText('Perfil creado.')).toBeInTheDocument()
  })

  it('renombra un perfil personalizado', async () => {
    // El rol seleccionado por defecto es TEACHER (builtIn); agregamos un custom para renombrar.
    mockedApi.mockReset()
    const withCustom = {
      ...response,
      roles: [...response.roles, { role: 'COORDINADOR', label: 'Coordinador', permissions: [] }],
    }
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      if (u === '/admin/org-roles') return [...orgRoles, { code: 'COORDINADOR', label: 'Coordinador', builtIn: false, active: true }] as never
      if (u === '/admin/profiles' && method === 'GET') return withCustom as never
      if (u === '/admin/org-roles/COORDINADOR' && method === 'PATCH') return {} as never
      return {} as never
    })

    render(<AdminProfilesPanel />)
    fireEvent.change(await screen.findByLabelText('Perfil a configurar'), { target: { value: 'COORDINADOR' } })
    const renameInput = await screen.findByLabelText('Nuevo nombre del perfil')
    fireEvent.change(renameInput, { target: { value: 'Coordinación' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/org-roles/COORDINADOR',
        expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('Coordinación') }),
      ),
    )
  })

  it('no permite eliminar perfiles del sistema', async () => {
    render(<AdminProfilesPanel />)
    await screen.findByText('Gestión de perfiles')
    // TEACHER es builtIn → el botón Eliminar está deshabilitado.
    expect(screen.getByRole('button', { name: /Eliminar perfil/ })).toBeDisabled()
  })
})
