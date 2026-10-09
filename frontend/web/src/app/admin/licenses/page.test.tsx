import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LicensesPage from './page'
import { licenseOutsideRange } from '@/lib/admin/licenses-display'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const schoolYearContextMock = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => schoolYearContextMock.current,
}))
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
    schoolYearContextMock.current = null
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

  it('aplica el ciclo lectivo seleccionado a licencias y días no laborables', async () => {
    schoolYearContextMock.current = {
      loading: false,
      years: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          code: 2025,
          label: 'Ciclo 2025',
          startsOn: '2025-03-01T00:00:00.000Z',
          endsOn: '2025-12-15T00:00:00.000Z',
          status: 'ACTIVE',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      activeId: '11111111-1111-4111-8111-111111111111',
      selectedId: '11111111-1111-4111-8111-111111111111',
      allYears: false,
      setSelectedId: vi.fn(),
      setAllYears: vi.fn(),
      reload: vi.fn(),
      schoolYearQuery: 'schoolYearId=11111111-1111-4111-8111-111111111111',
      schoolYearScopedQuery: 'schoolYearId=11111111-1111-4111-8111-111111111111',
    }
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('medical-leaves/all')) return { data: [] }
      if (String(url).includes('non-working-days')) return { data: [] }
      if (String(url).includes('admin/users')) return { data: [] }
      return { data: [] }
    })

    render(<LicensesPage />)

    await waitFor(() => {
      expect(mockedApi).toHaveBeenCalledWith(
        expect.stringContaining('/medical-leaves/all?'),
      )
      expect(mockedApi).toHaveBeenCalledWith(
        expect.stringContaining('schoolYearId=11111111-1111-4111-8111-111111111111'),
      )
      expect(mockedApi).toHaveBeenCalledWith(
        expect.stringContaining('/non-working-days?from=2025-03-01&to=2025-12-15&schoolYearId=11111111-1111-4111-8111-111111111111'),
      )
    })
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
    fireEvent.change(screen.getByLabelText('Fecha inicio'), { target: { value: '01/01/2025' } })
    fireEvent.change(screen.getByLabelText('Fecha fin'), { target: { value: '03/01/2025' } })
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

describe('LicensesPage: ciclos, páginas y totales', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    schoolYearContextMock.current = null
  })

  it('pagina las licencias y muestra los totales de todo el filtro', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('medical-leaves/all')) {
        const page = Number(new URL(u, 'http://x').searchParams.get('page'))
        return {
          data: [{ ...activeLicense, id: `lic-${page}`, reason: `Licencia de la página ${page}` }],
          pagination: { page, pageSize: 50, total: 75, totalPages: 2 },
          summary: { total: 75, active: 70, inactive: 5, medical: 60 },
        }
      }
      if (u.includes('admin/users')) return { data: [] }
      return { data: [] }
    })

    render(<LicensesPage />)

    expect(await screen.findByText(/Página 1 de 2 · 75 licencias/)).toBeInTheDocument()
    // Totales del filtro, no de la página visible (que tiene una sola licencia).
    expect(screen.getByText('70')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

    expect((await screen.findAllByText('Licencia de la página 2')).length).toBeGreaterThan(0)
    const lastCall = mockedApi.mock.calls.filter((c) => String(c[0]).includes('medical-leaves/all')).at(-1)!
    expect(String(lastCall[0])).toContain('page=2')
    expect(String(lastCall[0])).toContain('pageSize=50')
  })

  it('trae todo el personal, también después del usuario 100', async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.com`, firstName: 'U', lastName: String(i) }))
    mockedApi.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('medical-leaves/all')) return { data: [] }
      if (u.includes('admin/users') && u.includes('page=1')) return { data: firstPage, total: 101 }
      if (u.includes('admin/users') && u.includes('page=2')) {
        return { data: [{ id: 'u100', email: 'ultima@x.com', firstName: 'Última', lastName: 'Persona' }], total: 101 }
      }
      return { data: [] }
    })

    render(<LicensesPage />)

    await waitFor(() =>
      expect(mockedApi.mock.calls.some((c) => String(c[0]).includes('admin/users?pageSize=100&page=2'))).toBe(true),
    )
  })
})

describe('licenseOutsideRange', () => {
  it('dice si la licencia no toca el ciclo que se está mirando', () => {
    const cycle = { from: '2026-03-01', to: '2026-12-20' }
    expect(licenseOutsideRange({ startDate: '2027-02-01', endDate: '2027-02-03' }, cycle)).toBe(true)
    expect(licenseOutsideRange({ startDate: '2026-02-20', endDate: '2026-02-28' }, cycle)).toBe(true)
    // Cruza el inicio del ciclo: aparece en él.
    expect(licenseOutsideRange({ startDate: '2026-02-25', endDate: '2026-03-02' }, cycle)).toBe(false)
    expect(licenseOutsideRange({ startDate: '2026-12-20T12:00:00.000Z', endDate: '2026-12-23T12:00:00.000Z' }, cycle)).toBe(false)
  })
})
