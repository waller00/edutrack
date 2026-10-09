import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminStudentsPage from './page'
import { api } from '@/lib/api/client'
import { emptyStudentDraft, type StudentListRow } from '@/components/admin/students/student-types'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: vi.fn(),
}))

const mockedApi = vi.mocked(api)
const mockedYear = vi.mocked(useOptionalAdminSchoolYear)

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

const yearContext = {
  loading: false, years: [{ id: 'y1', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE', startsOn: null, endsOn: null, createdAt: '', updatedAt: '' }],
  activeId: 'y1', selectedId: 'y1', allYears: false, schoolYearQuery: 'schoolYearId=y1', schoolYearScopedQuery: 'schoolYearId=y1',
  setSelectedId: vi.fn(), setAllYears: vi.fn(), reload: vi.fn(),
}

function mockRows(rows: StudentListRow[], total = rows.length) {
  mockedApi.mockImplementation(async (url, init) => {
    const parsed = new URL(url, 'http://example.test')
    if (init?.method) return { message: 'Acción completada', moodle: rows[0]?.moodle } as never
    if (parsed.pathname.endsWith('/summary')) return { total, byStatus: { ACTIVE: total } } as never
    if (parsed.pathname === '/admin/students/s1') return { ...emptyStudentDraft(), ...student, documentId: '51234561', photo: null, tuitionMonths: [] } as never
    if (parsed.pathname === '/admin/students') return { total, page: Number(parsed.searchParams.get('page')), pageSize: 20, data: rows } as never
    if (parsed.pathname === '/courses/c1/orientations') return [{ id: 'co1', orientationId: 'ori1', orientation: { id: 'ori1', name: 'Científica', code: 'C' } }] as never
    if (parsed.pathname === '/courses') return [{ id: 'c1', name: 'Primero', code: '1' }, { id: 'c2', name: 'Segundo', code: '2' }] as never
    return [] as never
  })
}
function lastListQuery() {
  const calls = mockedApi.mock.calls.filter(([url, init]) => url.startsWith('/admin/students?') && !init?.method)
  return new URL(calls[calls.length - 1][0], 'http://example.test').searchParams
}
async function openRowMenu() {
  const table = await screen.findByRole('table')
  await waitFor(() => expect(within(table).getByText('García, Ana')).toBeInTheDocument())
  fireEvent.click(within(table).getByRole('button', { name: /Más acciones de Ana García/ }))
  return screen.getByRole('dialog', { name: /Acciones de Ana García/ })
}

describe('AdminStudentsPage', () => {
  beforeEach(() => {
    mockedYear.mockReturnValue(null)
    mockedApi.mockReset()
    mockEndpoints()
  })

  it('muestra el estudiante con badge de estado en la tabla', async () => {
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')
    expect(within(table).getByText('García, Ana')).toBeInTheDocument()
    expect(within(table).getByText('Activo')).toBeInTheDocument()
    expect(within(table).getByText('Pendiente')).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
    expect(within(table).queryByRole('button', { name: /Reenviar/ })).not.toBeInTheDocument()
    expect(within(table).queryByText(/Enviado/)).not.toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Ver ficha de Ana García' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Activos' }))

    const clear = await screen.findByRole('button', { name: /Limpiar/ })
    expect(clear).toHaveTextContent('1')
    fireEvent.click(clear)

    await waitFor(() => expect(screen.queryByRole('button', { name: /Limpiar/ })).not.toBeInTheDocument())
  })

  it('reenvía el correo Moodle tras confirmar en el diálogo', async () => {
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')

    fireEvent.click(within(table).getByRole('button', { name: 'Más acciones de Ana García' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar acceso' }))

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

    fireEvent.click(within(table).getByRole('button', { name: 'Más acciones de Ana García' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar estudiante' }))
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

  it('deja el resumen cerrado y todos los estados accesibles como botones', async () => {
    render(<AdminStudentsPage />)
    await screen.findByRole('table')
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Total')).not.toBeVisible()
    fireEvent.click(screen.getByText('Resumen de matrícula'))
    expect(screen.getByText('Total')).toBeVisible()
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument()
  })

  it.each([['Activos', 'ACTIVE'], ['Abandonaron', 'WITHDRAWN'], ['Egresados', 'GRADUATED'], ['Transferidos', 'TRANSFERRED']])('filtra por %s manteniendo el ciclo', async (label, value) => {
    mockedYear.mockReturnValue(yearContext)
    mockRows([student])
    render(<AdminStudentsPage />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(lastListQuery().get('status')).toBe(value))
    expect(lastListQuery().get('schoolYearId')).toBe('y1')
    expect(lastListQuery().get('includeMoodle')).toBe('1')
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    await waitFor(() => expect(lastListQuery().has('status')).toBe(false))
  })

  it('aplica la búsqueda después de la pausa y vuelve a la primera página', async () => {
    mockRows([student], 34)
    render(<AdminStudentsPage />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await waitFor(() => expect(lastListQuery().get('page')).toBe('2'))
    fireEvent.change(screen.getByLabelText('Buscar estudiante'), { target: { value: ' 12345678 ' } })
    await waitFor(() => expect(lastListQuery().get('q')).toBe('12345678'))
    expect(lastListQuery().get('page')).toBe('1')
  })

  it('despliega orientación, conserva la selección al plegar y la limpia al cambiar curso', async () => {
    mockRows([student])
    render(<AdminStudentsPage />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c1' } })
    const more = await screen.findByRole('button', { name: 'Más filtros' })
    expect(screen.queryByLabelText('Orientación')).not.toBeInTheDocument()
    fireEvent.click(more)
    fireEvent.change(screen.getByLabelText('Orientación'), { target: { value: 'ori1' } })
    await waitFor(() => expect(lastListQuery().get('orientationId')).toBe('ori1'))
    fireEvent.click(screen.getByRole('button', { name: /Más filtros/ }))
    expect(screen.queryByLabelText('Orientación')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar filtro de orientación Científica' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c2' } })
    await waitFor(() => expect(lastListQuery().get('courseId')).toBe('c2'))
    expect(lastListQuery().has('orientationId')).toBe(false)
  })

  it('limpia búsqueda, curso, orientación y estado a la vez', async () => {
    mockRows([student])
    render(<AdminStudentsPage />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c1' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Más filtros' }))
    fireEvent.change(screen.getByLabelText('Orientación'), { target: { value: 'ori1' } })
    fireEvent.change(screen.getByLabelText('Buscar estudiante'), { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Activos' }))
    const clear = screen.getByRole('button', { name: /Limpiar filtros/ })
    expect(clear).toHaveTextContent('4')
    fireEvent.click(clear)
    await waitFor(() => expect(lastListQuery().has('status')).toBe(false))
    expect(lastListQuery().has('courseId')).toBe(false)
    expect(lastListQuery().has('orientationId')).toBe(false)
    expect(screen.getByLabelText('Buscar estudiante')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['VERIFIED', true, true],
    ['UNAVAILABLE', true, true],
    ['NOT_FOUND', false, false],
  ] as const)('oculta acciones de Moodle que no corresponden (%s)', async (state, linked, canProvision) => {
    mockRows([{ ...student, moodle: { ...student.moodle, state, linked, canProvision } }])
    render(<AdminStudentsPage />)
    const menu = await openRowMenu()
    expect(within(menu).getAllByRole('button')).toHaveLength(1)
    expect(within(menu).getByRole('button', { name: 'Eliminar estudiante' })).toBeInTheDocument()
    expect(mockedApi.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0)
  })

  it.each([[false, 'Crear cuenta en Moodle'], [true, 'Recrear cuenta']])('usa provision para crear o recuperar cuentas (%s)', async (linked, actionLabel) => {
    mockRows([{ ...student, moodle: { ...student.moodle, state: 'NOT_FOUND', linked, canProvision: true } }])
    render(<AdminStudentsPage />)
    const menu = await openRowMenu()
    fireEvent.click(within(menu).getByRole('button', { name: actionLabel as string }))
    const confirm = screen.getByRole('dialog', { name: 'Crear cuenta en el aula virtual' })
    expect(mockedApi.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Crear cuenta' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/students/s1/moodle-account', { method: 'POST' }))
    expect(mockedApi).not.toHaveBeenCalledWith('/admin/students/s1/moodle-welcome/resend', { method: 'POST' })
  })

  it('no envía acceso Moodle si se cancela la confirmación', async () => {
    render(<AdminStudentsPage />)
    fireEvent.click(within(await openRowMenu()).getByRole('button', { name: 'Reenviar acceso' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(mockedApi.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0)
  })

  it('mantiene cinco columnas en todos los ciclos y elimina por studentId, no enrollmentId', async () => {
    mockedYear.mockReturnValue({ ...yearContext, allYears: true, selectedId: null, schoolYearQuery: 'allYears=1' })
    mockRows([{ ...student, id: 'enrollment-y2', enrollmentId: 'enrollment-y2', schoolYearCode: 2025 }])
    render(<AdminStudentsPage />)
    const menu = await openRowMenu()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5)
    expect(within(table).getByText('Ciclo 2025')).toBeInTheDocument()
    expect(screen.getByText('Mostrando 1–1 de 1 matrículas')).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('button', { name: 'Eliminar estudiante' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/students/s1', { method: 'DELETE' }))
    expect(mockedApi).not.toHaveBeenCalledWith('/admin/students/enrollment-y2', { method: 'DELETE' })
  })

  it('abre la ficha del estudiante en el ciclo seleccionado y conserva el ciclo al guardar', async () => {
    mockedYear.mockReturnValue(yearContext)
    mockRows([student])
    render(<AdminStudentsPage />)
    const table = await screen.findByRole('table')
    await waitFor(() => expect(within(table).getByText('García, Ana')).toBeInTheDocument())
    fireEvent.click(within(table).getByRole('button', { name: 'Ver ficha de Ana García' }))
    await screen.findByDisplayValue('Ana')
    expect(mockedApi).toHaveBeenCalledWith('/admin/students/s1?schoolYearId=y1')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mockedApi.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    const write = mockedApi.mock.calls.find(([, init]) => init?.method === 'PUT')!
    const body = JSON.parse(write[1]!.body as string)
    expect(body.schoolYearId).toBe('y1')
    expect(body).not.toHaveProperty('tuitionMonths')
  })


  it('vuelve a la primera página cuando cambia el ciclo lectivo', async () => {
    mockedYear.mockReturnValue(yearContext)
    mockRows([student], 34)
    const view = render(<AdminStudentsPage />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    await waitFor(() => expect(lastListQuery().get('page')).toBe('2'))
    mockedYear.mockReturnValue({ ...yearContext, selectedId: 'y2', schoolYearQuery: 'schoolYearId=y2' })
    view.rerender(<AdminStudentsPage />)
    await waitFor(() => expect(lastListQuery().get('page')).toBe('1'))
    expect(lastListQuery().get('schoolYearId')).toBe('y2')
  })

  it('descarta una respuesta anterior cuando ya se eligió otro estado', async () => {
    let resolveInitial!: (value: unknown) => void
    const initial = new Promise((resolve) => { resolveInitial = resolve })
    mockedApi.mockImplementation(async (url) => {
      if (url.includes('/summary')) return { total: 2, byStatus: { ACTIVE: 1, WITHDRAWN: 1 } } as never
      if (url.startsWith('/admin/students?')) {
        if (!url.includes('status=ACTIVE')) return await initial as never
        return { total: 1, page: 1, pageSize: 20, data: [student] } as never
      }
      return [] as never
    })
    render(<AdminStudentsPage />)
    await waitFor(() => expect(mockedApi.mock.calls.some(([url]) => url.startsWith('/admin/students?'))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Activos' }))
    await screen.findAllByText('García, Ana')
    await act(async () => resolveInitial({ total: 2, page: 1, pageSize: 20, data: [{ ...student, id: 'other', firstName: 'Berta' }] }))
    expect(screen.queryByText('García, Berta')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activos' })).toHaveAttribute('aria-pressed', 'true')
  })

})
