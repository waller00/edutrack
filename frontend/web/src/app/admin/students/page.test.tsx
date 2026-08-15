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
    expect(within(table).getByRole('button', { name: 'Reenviar correo Moodle a Ana García' })).toBeInTheDocument()
  })

  it('renderiza las tarjetas mobile además de la tabla', async () => {
    render(<AdminStudentsPage />)
    // El nombre aparece en la fila de tabla y en la tarjeta mobile.
    const matches = await screen.findAllByText('García, Ana')
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('muestra "Limpiar" con el contador al activar un filtro y lo resetea', async () => {
    render(<AdminStudentsPage />)
    await screen.findByRole('table')

    expect(screen.queryByRole('button', { name: /Limpiar/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'ACTIVE' } })

    const clear = await screen.findByRole('button', { name: 'Limpiar (1)' })
    fireEvent.click(clear)

    await waitFor(() => expect(screen.queryByRole('button', { name: /Limpiar/ })).not.toBeInTheDocument())
  })

  it('reenvía el correo Moodle desde la fila pendiente', async () => {
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')

    fireEvent.click(within(table).getByRole('button', { name: 'Reenviar correo Moodle a Ana García' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/students/s1/moodle-welcome/resend', { method: 'POST' }),
    )
    expect(await screen.findByText('Correo de acceso a Moodle reenviado')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('marca email y usuario Moodle como obligatorios en el alta', async () => {
    render(<AdminStudentsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo estudiante' }))

    const email = document.querySelector('input[type="email"]')
    const username = document.querySelector('input[placeholder="nombre.apellido"]')
    expect(email).toBeRequired()
    expect(username).toBeRequired()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })
})
