import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminStudentsPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => null,
}))

const mockedApi = vi.mocked(api)

const student = {
  id: 's1',
  studentId: 's1',
  firstName: 'Ana',
  lastName: 'García',
  documentId: '1.234.567-8',
  schoolYearCode: 2026,
  courseId: 'c1',
  course: { id: 'c1', name: 'Primero', code: '1' },
  enrollmentStatus: 'ACTIVE',
  withdrawnAt: null,
  withdrawalAcademicYear: null,
  healthCardExpiresAt: null,
  moodle: {
    state: 'PENDING' as const,
    linked: true,
    canProvision: true,
    verified: false,
    accountExists: true,
    moodleUserId: 72,
    firstAccessAt: null,
    welcomeSentAt: '2026-01-02T12:00:00.000Z',
  },
  createdAt: '2026-01-01',
  tuitionMonthsPreview: [{ year: 2026, month: 3, paid: true }],
}

function mockEndpoints() {
  mockedApi.mockImplementation(async (url: string) => {
    if (String(url).includes('/moodle-welcome/resend')) {
      return { message: 'Correo de acceso a Moodle reenviado', moodle: student.moodle } as never
    }
    if (String(url).includes('/admin/students/summary')) {
      return { total: 1, byStatus: { ACTIVE: 1 } } as never
    }
    if (String(url).includes('/admin/students')) {
      return { total: 1, page: 1, pageSize: 20, data: [student] } as never
    }
    if (String(url).includes('/courses')) {
      return [{ id: 'c1', name: 'Primero', code: '1' }] as never
    }
    return { data: [] } as never
  })
}

describe('AdminStudentsPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockEndpoints()
  })

  it('muestra el estudiante con badge de estado en la tabla', async () => {
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')
    expect(within(table).getByText('García, Ana')).toBeInTheDocument()
    expect(within(table).getByText('Activo')).toBeInTheDocument()
    expect(within(table).getByText('Pendiente')).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Reenviar acceso de Ana García' })).toBeInTheDocument()
  })

  it('renderiza las tarjetas mobile además de la tabla', async () => {
    render(<AdminStudentsPage />)
    // El nombre aparece en la fila de tabla y en la tarjeta mobile.
    const matches = await screen.findAllByText('García, Ana')
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('lleva las mensualidades a su módulo y no las reemplaza al guardar la ficha', async () => {
    mockedApi.mockImplementation(async (url, init) => {
      if (url === '/admin/students/s1') {
        if (init?.method === 'PUT') return {} as never
        return { ...student, id: 's1', documentId: '51234561', tuitionMonths: [{ year: 2026, month: 3, paid: true, amountCents: 350000 }] } as never
      }
      if (url.includes('/summary')) return { total: 1, byStatus: { ACTIVE: 1 } } as never
      if (url.startsWith('/admin/students')) return { total: 1, page: 1, pageSize: 20, data: [student] } as never
      return [] as never
    })
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')
    expect(within(table).queryByRole('columnheader', { name: /Mensualidades/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mensualidades' })).toHaveAttribute('href', '/admin/tuition')
    fireEvent.click(within(table).getByRole('button', { name: 'García, Ana' }))
    await screen.findByDisplayValue('Ana')
    expect(screen.queryByRole('tab', { name: 'Mensualidades' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => {
      const call = mockedApi.mock.calls.find(([, init]) => init?.method === 'PUT')
      expect(call).toBeDefined()
      expect(JSON.parse(call![1]!.body as string)).not.toHaveProperty('tuitionMonths')
    })
  })

  it('muestra "Limpiar" con el contador al activar un filtro y lo resetea', async () => {
    render(<AdminStudentsPage />)
    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: /Limpiar/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'ACTIVE' } })

    const clear = await screen.findByRole('button', { name: /Limpiar/ })
    expect(clear).toHaveTextContent('1')
    fireEvent.click(clear)

    await waitFor(() => expect(screen.queryByRole('button', { name: /Limpiar/ })).not.toBeInTheDocument())
  })

  it('reenvía el correo Moodle tras confirmar en el diálogo', async () => {
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')

    fireEvent.click(within(table).getByRole('button', { name: 'Reenviar acceso de Ana García' }))

    // Ya no hay confirm() nativo: la confirmación es un diálogo accesible.
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reenviar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/students/s1/moodle-welcome/resend', { method: 'POST' }),
    )
    expect(await screen.findByText(/Correo de acceso a Moodle reenviado/)).toBeInTheDocument()
  })

  it('pide confirmación antes de eliminar y no llama al API si se cancela', async () => {
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')

    fireEvent.click(within(table).getByRole('button', { name: 'Eliminar a García, Ana' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedApi).not.toHaveBeenCalledWith('/admin/students/s1', { method: 'DELETE' })
  })

  it('el alta ya no exige email ni usuario del aula virtual', async () => {
    // Se sacaron a propósito: la cuenta de Moodle se crea después, desde la ficha. Exigirlos
    // trababa el alta cuando no se tenían a mano.
    render(<AdminStudentsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo estudiante' }))

    // El alta sólo muestra lo esencial: el contacto queda plegado.
    expect(document.querySelector('input[type="email"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Contacto y aula virtual/ }))
    expect(document.querySelector('input[type="email"]')).not.toBeRequired()

    // Y el botón Guardar se puede tocar: dice qué falta en vez de quedarse muerto.
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled()
  })
})
