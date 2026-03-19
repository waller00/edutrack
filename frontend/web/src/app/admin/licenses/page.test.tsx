import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LicensesPage from './page'
import { api } from '@/lib/api'

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/components/DateRangeFields', () => ({
  default: () => <div data-testid="dr" />,
}))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const pendingLicense = {
  id: 'lic1',
  userId: 'u1',
  type: 'MEDICAL_LEAVE' as const,
  status: 'PENDING' as const,
  startDate: '2025-01-01',
  endDate: '2025-01-03',
  reason: 'Reposo',
  createdAt: '2025-01-01',
  user: { id: 'u1', name: 'Ana G', email: 'a@b.com', role: 'TEACHER' },
}

describe('LicensesPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('carga licencias y permite aprobar', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [pendingLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      if (String(url).includes('medical-leaves/lic1') && init?.method === 'PUT') return {}
      return { data: [] }
    })

    render(<LicensesPage />)

    expect(await screen.findByText('Gestión de Licencias')).toBeInTheDocument()
    expect(await screen.findByText('Reposo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/medical-leaves/lic1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ status: 'APPROVED' }),
        }),
      ),
    )
  })

  it('lista vacía', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('medical-leaves/all')) return { data: [] }
      if (String(url).includes('admin/users')) return { data: [] }
      return {}
    })

    render(<LicensesPage />)

    expect(await screen.findByText('No hay licencias registradas')).toBeInTheDocument()
  })

  it('rechaza licencia pendiente', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [pendingLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      if (String(url).includes('medical-leaves/lic1') && init?.method === 'PUT') return {}
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findByText('Reposo')

    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/medical-leaves/lic1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ status: 'REJECTED' }),
        }),
      ),
    )
  })

  it('edita y guarda licencia', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [pendingLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      if (String(url).includes('medical-leaves/lic1') && init?.method === 'PUT') return {}
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findByText('Reposo')

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    await screen.findByRole('heading', { name: 'Editar Licencia' })

    fireEvent.change(screen.getByDisplayValue('Reposo'), { target: { value: 'Reposo extendido' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cambios' }))

    await waitFor(() => {
      const put = mockedApi.mock.calls.find(
        (c) => String(c[0]).includes('medical-leaves/lic1') && (c[1] as RequestInit)?.method === 'PUT',
      )
      expect(put).toBeDefined()
      const body = JSON.parse((put![1] as RequestInit).body as string)
      expect(body.reason).toBe('Reposo extendido')
    })
  })

  it('elimina licencia', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('medical-leaves/all')) return { data: [pendingLicense] }
      if (String(url).includes('admin/users')) {
        return { data: [{ id: 'u1', email: 'a@b.com', firstName: 'Ana', lastName: 'G' }] }
      }
      if (String(url).endsWith('/medical-leaves/lic1') && init?.method === 'DELETE') return {}
      return { data: [] }
    })

    render(<LicensesPage />)
    await screen.findByText('Reposo')

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/medical-leaves/lic1', expect.objectContaining({ method: 'DELETE' })),
    )
  })
})
