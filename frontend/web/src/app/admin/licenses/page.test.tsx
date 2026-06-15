import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LicensesPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const activeLicense = {
  id: 'lic1',
  userId: 'u1',
  type: 'MEDICAL_LEAVE' as const,
  status: 'ACTIVE' as const,
  startDate: '2025-01-01',
  endDate: '2025-01-03',
  reason: 'Licencia médica presentada',
  createdAt: '2025-01-01',
  user: { id: 'u1', name: 'Ana G', email: 'a@b.com', role: 'TEACHER' },
}

describe('LicensesPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('carga licencias sin acciones de aprobación', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [activeLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      return { data: [] }
    })

    render(<LicensesPage />)

    expect(await screen.findByText('Gestión de licencias')).toBeInTheDocument()
    expect((await screen.findAllByText('Licencia médica presentada')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument()
  })

  it('lista vacía', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('medical-leaves/all')) return { data: [] }
      if (String(url).includes('admin/users')) return { data: [] }
      return {}
    })

    render(<LicensesPage />)

    expect((await screen.findAllByText('No hay licencias registradas')).length).toBeGreaterThan(0)
  })

  it('muestra días no laborables como fecha civil sin corrimiento horario', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('medical-leaves/all')) return { data: [] }
      if (String(url).includes('non-working-days')) {
        return {
          data: [
            {
              id: 'nwd-1',
              date: '2026-06-12T00:00:00.000Z',
              type: 'HOLIDAY',
              reason: 'Feriado',
              notes: null,
            },
          ],
        }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      return { data: [] }
    })

    render(<LicensesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Días no laborables' }))

    expect((await screen.findAllByText('12/06/2026')).length).toBeGreaterThan(0)
  })

  it('elimina licencias seleccionadas', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [activeLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      if (String(url).endsWith('/medical-leaves/lic1') && init?.method === 'DELETE') return {}
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findAllByText('Licencia médica presentada')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(within(screen.getByRole('table')).getByRole('checkbox', { name: 'Seleccionar licencia de Ana G' }))

    // El botón está disabled mientras no haya selección aplicada; esperar a que
    // el estado se refleje evita un click no-op en CI (timing) que no dispara el DELETE.
    const deleteButton = screen.getByRole('button', { name: 'Eliminar seleccionadas' })
    await waitFor(() => expect(deleteButton).toBeEnabled())
    fireEvent.click(deleteButton)

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/medical-leaves/lic1', expect.objectContaining({ method: 'DELETE' })),
    )
  })

  it('selecciona todas las licencias activas desde la cabecera', async () => {
    const inactiveLicense = { ...activeLicense, id: 'lic2', status: 'INACTIVE' as const, user: { ...activeLicense.user, name: 'Luis P' } }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('medical-leaves/all')) return { data: [activeLicense, inactiveLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findAllByRole('checkbox', { name: 'Seleccionar licencia de Ana G' })

    const table = screen.getByRole('table')
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Seleccionar todas las licencias' }))

    expect(within(table).getByRole('checkbox', { name: 'Seleccionar licencia de Ana G' })).toBeChecked()
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar licencia de Luis P' })).not.toBeChecked()
    expect(within(table).getByRole('checkbox', { name: 'Seleccionar licencia de Luis P' })).toBeDisabled()
  })

  it('edita y guarda licencia', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [activeLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      if (String(url).includes('medical-leaves/lic1') && init?.method === 'PUT') return {}
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findAllByText('Licencia médica presentada')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Editar' }))
    await screen.findByRole('heading', { name: 'Editar Licencia' })

    expect(screen.getByText(/solo la constancia administrativa/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => {
      const put = mockedApi.mock.calls.find(
        (c) => String(c[0]).includes('medical-leaves/lic1') && (c[1] as RequestInit)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      const body = JSON.parse((put![1] as RequestInit).body as string)
      expect(body.reason).toBeUndefined()
      expect(body.notes).toBeUndefined()
    })
  })

  it('crea licencia', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [activeLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      if (String(url) === '/medical-leaves' && init?.method === 'POST') return {}
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findByText('Gestión de licencias')

    fireEvent.click(screen.getByRole('button', { name: /nueva licencia/i }))
    fireEvent.change(screen.getByLabelText('Usuario de licencia'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText('Fecha inicio'), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText('Fecha fin'), { target: { value: '2025-01-03' } })
    expect(screen.queryByLabelText('Motivo (obligatorio)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Crear Licencia' }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(
        (c) => c[0] === '/medical-leaves' && (c[1] as RequestInit)?.method === 'POST',
      )
      expect(post).toBeDefined()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.reason).toBeUndefined()
      expect(body.notes).toBeUndefined()
    })
  })

  it('renderiza las tarjetas mobile además de la tabla', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('medical-leaves/all')) return { data: [activeLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      return { data: [] }
    })

    render(<LicensesPage />)

    // El motivo aparece tanto en la fila de tabla como en la tarjeta mobile.
    const matches = await screen.findAllByText('Licencia médica presentada')
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('"Limpiar" recarga las licencias con los filtros reseteados', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('medical-leaves/all')) return { data: [activeLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findAllByText('Licencia médica presentada')

    const callsBefore = mockedApi.mock.calls.filter((c) => String(c[0]).includes('medical-leaves/all')).length
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }))

    await waitFor(() => {
      const callsAfter = mockedApi.mock.calls.filter((c) => String(c[0]).includes('medical-leaves/all')).length
      expect(callsAfter).toBeGreaterThan(callsBefore)
    })
  })
})
