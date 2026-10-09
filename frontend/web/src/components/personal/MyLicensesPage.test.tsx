import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import MyLicensesPage from './MyLicensesPage'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="guard">{children}</div>
  ),
}))

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ me: { id: 'self' } }),
}))

describe('MyLicensesPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
  })

  it('muestra solo las licencias del usuario', async () => {
    vi.mocked(api).mockResolvedValue({
      data: [
        {
          id: 'l1',
          type: 'MEDICAL_LEAVE',
          status: 'ACTIVE',
          startDate: '2025-01-01',
          endDate: '2025-01-03',
          reason: 'Licencia médica presentada',
          notes: 'Control',
        },
      ],
    })

    render(<MyLicensesPage role="STAFF" />)

    expect(
      await screen.findByText('Licencia médica presentada'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Mis Licencias' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Control')).not.toBeVisible()
    fireEvent.click(screen.getByText('Notas de la licencia'))
    expect(screen.getByText('Control')).toBeVisible()
    expect(screen.getByText('01/01/2025 – 03/01/2025')).toBeInTheDocument()
    expect(screen.getByText('Licencia médica presentada')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /editar/i }),
    ).not.toBeInTheDocument()
  })
})

it('incluye todas las páginas del servidor y filtra por estado, búsqueda y fechas', async () => {
  vi.mocked(api).mockReset()
  const license = (id: string, status = 'ACTIVE', startDate = '2026-10-01', reason = 'Control de salud') => ({ id, type: 'MEDICAL_LEAVE', status, startDate, endDate: startDate, reason })
  vi.mocked(api).mockResolvedValueOnce({ data: [license('first')], pagination: { totalPages: 2 } })
    .mockResolvedValueOnce({ data: [license('second', 'INACTIVE', '2026-09-01', 'Licencia anterior')] })
  render(<MyLicensesPage />)
  await screen.findByText('2 licencias')
  expect(api).toHaveBeenCalledWith('/medical-leaves/my-leaves?pageSize=100&page=2')
  fireEvent.click(screen.getByRole('button', { name: 'Activas' }))
  expect(screen.getByText('Control de salud')).toBeVisible()
  expect(screen.queryByText('Licencia anterior')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'anterior' } })
  expect(screen.queryByText('Control de salud')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
  fireEvent.click(screen.getByRole('button', { name: /^Período/ }))
  fireEvent.change(screen.getByLabelText('Fecha inicio'), { target: { value: '01/10/2026' } })
  fireEvent.change(screen.getByLabelText('Fecha fin'), { target: { value: '31/10/2026' } })
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
  expect(screen.getByText('Control de salud')).toBeVisible()
  expect(screen.queryByText('Licencia anterior')).not.toBeInTheDocument()
})
