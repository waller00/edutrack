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
  })

  it('actualiza un permiso sin cambiar permisos reales', async () => {
    mockedApi.mockResolvedValueOnce(response).mockResolvedValueOnce(response)

    render(<AdminProfilesPage />)
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles/TEACHER/permissions/attendance.read',
        expect.objectContaining({ method: 'PUT' }),
      ),
    )
    expect(await screen.findByText(/No se cambiaron los accesos reales/)).toBeInTheDocument()
  })

  it('crea un permiso nuevo para Tutor', async () => {
    mockedApi.mockResolvedValueOnce(response).mockResolvedValueOnce(response)

    render(<AdminProfilesPage />)
    await screen.findByText('Tutor')

    fireEvent.change(screen.getAllByPlaceholderText('Módulo, por ejemplo Reportes')[0], {
      target: { value: 'Reportes' },
    })
    fireEvent.change(screen.getAllByPlaceholderText('Acción, por ejemplo read')[0], { target: { value: 'read' } })
    fireEvent.change(screen.getAllByPlaceholderText('Nombre visible')[0], { target: { value: 'Ver reportes' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Crear permiso/ })[0])

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/profiles/TEACHER/permissions',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })
})
