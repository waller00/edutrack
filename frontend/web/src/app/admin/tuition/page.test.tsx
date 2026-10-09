import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import AdminTuitionPage from './page'

vi.mock('@/components/auth/RoleGuard', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: vi.fn() }))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const result = { year: 2026, month: 3, page: 1, pageSize: 20, total: 30,
  summary: { students: 30, paid: 20, pending: 4, none: 6, collectedCents: 6000000, pendingCents: 1200000, paidWithoutAmount: 0, pendingWithoutAmount: 0 },
  data: [{ id: 's1', firstName: 'Ana', lastName: 'Díaz', course: { id: 'c1', name: 'Primero' }, tuitionMonths: [] }],
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(useOptionalAdminSchoolYear).mockReturnValue(null)
  vi.mocked(api).mockImplementation(async (url) => url.startsWith('/courses') ? [] : result)
})

it('cambia el período y distingue pendientes de cuotas sin registrar en la consulta', async () => {
  render(<AdminTuitionPage />)
  await screen.findByRole('table')
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: '2026-03' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pendientes' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.includes('month=3') && url.includes('status=pending'))).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Sin registrar' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.includes('month=3') && url.includes('status=none'))).toBe(true))
  fireEvent.click(screen.getByText('Resumen de Marzo 2026'))
  expect(screen.getByRole('button', { name: 'Mostrar estudiantes' })).toHaveTextContent('30')
})

it('vuelve a la primera página al cambiar el mes', async () => {
  render(<AdminTuitionPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }))
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.includes('page=2'))).toBe(true))
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: '2026-02' } })
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


const yearContext = {
  loading: false, years: [{ id: 'y1', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE', startsOn: null, endsOn: null, createdAt: '', updatedAt: '' }, { id: 'y2', code: 2025, label: 'Ciclo 2025', status: 'CLOSED', startsOn: null, endsOn: null, createdAt: '', updatedAt: '' }],
  activeId: 'y1', selectedId: 'y1', allYears: false, schoolYearQuery: 'schoolYearId=y1', schoolYearScopedQuery: 'schoolYearId=y1',
  setSelectedId: vi.fn(), setAllYears: vi.fn(), reload: vi.fn(),
}
function mockList() {
  vi.mocked(api).mockImplementation(async (url) => {
    if (url.startsWith('/courses')) return [{ id: 'c1', name: 'Primero' }]
    const query = new URL(url, 'http://example.test').searchParams
    return { ...result, year: Number(query.get('year')), month: Number(query.get('month')), page: Number(query.get('page')) }
  })
}
function lastQuery() {
  const calls = vi.mocked(api).mock.calls.filter(([url]) => url.startsWith('/admin/tuition?'))
  return new URL(calls[calls.length - 1][0], 'http://example.test').searchParams
}

it('empieza con todos los estados y resumen cerrado', async () => {
  render(<AdminTuitionPage />)
  const table = await screen.findByRole('table')
  expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
  expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Pendientes' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pagados' })).toBeInTheDocument()
  expect(screen.getByText('20')).not.toBeVisible()
  expect(screen.queryByRole('button', { name: 'Marzo' })).not.toBeInTheDocument()
})

it.each([['Pendientes', 'pending'], ['Pagados', 'paid'], ['Sin registrar', 'none']])('filtra %s conservando el período y el curso', async (label, status) => {
  mockList()
  render(<AdminTuitionPage />)
  await screen.findByRole('table')
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: '2026-03' } })
  fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c1' } })
  fireEvent.click(screen.getByRole('button', { name: label }))
  await waitFor(() => expect(lastQuery().get('status')).toBe(status))
  expect(lastQuery().get('year')).toBe('2026')
  expect(lastQuery().get('month')).toBe('3')
  expect(lastQuery().get('courseId')).toBe('c1')
  expect(lastQuery().get('page')).toBe('1')
  expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method)).toBe(false)
})

it('limpia búsqueda, curso y estado sin cambiar el período elegido', async () => {
  mockList()
  render(<AdminTuitionPage />)
  await screen.findByRole('table')
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: '2026-03' } })
  fireEvent.change(screen.getByLabelText('Buscar estudiante'), { target: { value: ' Ana ' } })
  fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pagados' }))
  await waitFor(() => expect(lastQuery().get('q')).toBe('Ana'))
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
  await waitFor(() => expect(lastQuery().has('q')).toBe(false))
  expect(lastQuery().has('courseId')).toBe(false)
  expect(lastQuery().get('status')).toBe('all')
  expect(lastQuery().get('year')).toBe('2026')
  expect(lastQuery().get('month')).toBe('3')
})

it('al cambiar de año limpia el curso y usa el ciclo correspondiente', async () => {
  vi.mocked(useOptionalAdminSchoolYear).mockReturnValue(yearContext)
  mockList()
  render(<AdminTuitionPage />)
  await screen.findByRole('table')
  await waitFor(() => expect(screen.getByRole('option', { name: 'Primero' })).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c1' } })
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: '2025-04' } })
  await waitFor(() => expect(lastQuery().get('year')).toBe('2025'))
  expect(lastQuery().get('month')).toBe('4')
  expect(lastQuery().has('courseId')).toBe(false)
  expect(api).toHaveBeenCalledWith('/courses?schoolYearId=y2')
})

it('abre el formulario de pago sólo a pedido y no guarda al abrirlo', async () => {
  mockList()
  render(<AdminTuitionPage />)
  await screen.findByRole('table')
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: '2026-03' } })
  await waitFor(() => expect(lastQuery().get('month')).toBe('3'))
  fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Registrar pago de Ana Díaz' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('radio', { name: 'Pagado' })).toBeChecked()
  expect(within(dialog).getByRole('heading', { name: 'Marzo 2026' })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Enero: Sin registrar' })).not.toBeVisible()
  expect(screen.getByRole('table')).toBeInTheDocument()
  expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method)).toBe(false)
})

it('Mes actual vuelve al período vigente sin perder el estado seleccionado', async () => {
  mockList()
  render(<AdminTuitionPage />)
  await screen.findByRole('table')
  fireEvent.change(screen.getByLabelText('Período'), { target: { value: '2001-01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Pendientes' }))
  fireEvent.click(screen.getByRole('button', { name: 'Mes actual' }))
  const now = new Date()
  await waitFor(() => expect(lastQuery().get('year')).toBe(String(now.getFullYear())))
  expect(lastQuery().get('month')).toBe(String(now.getMonth() + 1))
  expect(lastQuery().get('status')).toBe('pending')
})
