import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import AdminTuitionPage from './page'

vi.mock('@/components/auth/RoleGuard', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => null }))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const result = { year: 2026, month: 3, page: 1, pageSize: 20, total: 30,
  summary: { students: 30, paid: 20, pending: 4, none: 6, collectedCents: 6000000, pendingCents: 1200000, paidWithoutAmount: 0, pendingWithoutAmount: 0 },
  data: [{ id: 's1', firstName: 'Ana', lastName: 'Díaz', course: { id: 'c1', name: 'Primero' }, tuitionMonths: [] }],
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api).mockImplementation(async (url) => url.startsWith('/courses') ? [] : result)
})

it('cambia el período y distingue pendientes de cuotas sin registrar en la consulta', async () => {
  render(<AdminTuitionPage />)
  await screen.findByRole('table')
  fireEvent.click(screen.getByRole('button', { name: 'Marzo' }))
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar pendientes' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.includes('month=3') && url.includes('status=pending'))).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar sin registrar' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.includes('month=3') && url.includes('status=none'))).toBe(true))
  expect(screen.getByRole('button', { name: 'Mostrar estudiantes' })).toHaveTextContent('30')
})

it('vuelve a la primera página al cambiar el mes', async () => {
  render(<AdminTuitionPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.includes('page=2'))).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Febrero' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toContain('month=2&page=1'))
})

it('muestra un error con reintento si el listado falla', async () => {
  vi.mocked(api).mockImplementation(async (url) => { if (url.startsWith('/courses')) return []; throw new Error('No se pudo conectar') })
  render(<AdminTuitionPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar')
  vi.mocked(api).mockImplementation(async (url) => url.startsWith('/courses') ? [] : result)
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  expect(await screen.findByRole('table')).toBeInTheDocument()
})
