import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminProfilesPage from './page'
import { api } from '@/lib/api'

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))

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
      label: 'Tutor',
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

describe('AdminProfilesPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('carga roles y permisos por módulo', async () => {
    mockedApi.mockResolvedValueOnce(response)

    render(<AdminProfilesPage />)

    expect(await screen.findByText('Gestión de perfiles')).toBeInTheDocument()
    expect(screen.getByText('Tutor')).toBeInTheDocument()
    expect(screen.getByText('Asistencias')).toBeInTheDocument()
    expect(screen.getByText('Ver mis asistencias')).toBeInTheDocument()
    expect(screen.getByText('2 activos')).toBeInTheDocument()
  })

  it('marca un permiso y guarda el perfil', async () => {
    mockedApi.mockResolvedValueOnce(response).mockResolvedValueOnce(response)

    render(<AdminProfilesPage />)
    const checkbox = await screen.findByRole('checkbox', { name: /Ver reportes internos/i })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /^Guardar$/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    expect(mockedApi).toHaveBeenLastCalledWith('/admin/profiles/TEACHER/permissions', expect.objectContaining({ method: 'PUT' }))
    expect(await screen.findByText('Perfil guardado.')).toBeInTheDocument()
  })

  it('crea un perfil nuevo con permisos seleccionados', async () => {
    mockedApi.mockResolvedValueOnce(response).mockResolvedValueOnce(response)

    render(<AdminProfilesPage />)
    await screen.findByText('Tutor')

    fireEvent.click(screen.getByRole('button', { name: /Nuevo perfil/ }))
    fireEvent.change(screen.getByPlaceholderText('Ej: Coordinador'), { target: { value: 'Coordinador' } })
    fireEvent.click(screen.getAllByRole('checkbox', { name: /Ver mis asistencias/i })[0])
    fireEvent.click(screen.getAllByRole('button', { name: /^Guardar$/ })[0])

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    expect(mockedApi).toHaveBeenLastCalledWith('/admin/profiles', expect.objectContaining({ method: 'POST' }))
    expect(await screen.findByText('Perfil creado.')).toBeInTheDocument()
  })
})
