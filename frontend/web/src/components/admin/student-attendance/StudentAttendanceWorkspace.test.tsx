import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import StudentAttendanceWorkspace from './StudentAttendanceWorkspace'
import StudentAttendanceRecord from './StudentAttendanceRecord'
import { api } from '@/lib/api/client'

const state = vi.hoisted(() => ({ query: '', canJustify: true, push: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query), usePathname: () => '/admin/student-attendance', useRouter: () => ({ push: state.push }) }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => ({ me: { permissions: [{ id: 'student-attendance.read', scope: 'all' }, ...(state.canJustify ? [{ id: 'student-attendance.justify', scope: 'all' }] : [])] } }) }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => ({ schoolYearScopedQuery: 'schoolYearId=sy1' }) }))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))

const student = { id: 'st1', firstName: 'Ana', lastName: 'Díaz', documentId: '5123', courseName: '7 EBI' }
let saved: boolean
beforeEach(() => {
  state.query = ''; state.canJustify = true; saved = false
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (init?.method === 'POST') { saved = true; return { justifiedCount: 1 } as never }
    if (path.includes('/justification-ranges?')) return { data: [] } as never
    if (path.includes('/students/st1')) return { student, byDay: true, overall: { absent: saved ? 0 : 1, absentJustified: saved ? 1 : 0, late: 0, absenceUnits: saved ? 0.5 : 1 }, entries: [
      { entryId: 'e1', status: saved ? 'ABSENT_JUSTIFIED' : 'ABSENT', ymd: '2026-10-05', subject: 'Matemática', title: 'Clase', note: null },
    ] } as never
    return { data: [student], page: 1, pageSize: 25, total: 1 } as never
  })
})

describe('directorio y ficha de asistencia', () => {
  it('muestra estudiantes sin exigir una búsqueda y abre la carga para la persona elegida', async () => {
    render(<StudentAttendanceWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar licencia a Ana Díaz' }))
    expect(state.push).toHaveBeenCalledWith('/admin/student-attendance?studentId=st1&action=justificar')
    expect(api).toHaveBeenCalledWith('/admin/student-attendance/students?q=&page=1&schoolYearId=sy1')
  })
  it('filtra el directorio por curso o nombre dentro del ciclo', async () => {
    render(<StudentAttendanceWorkspace />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar estudiante o curso' }), { target: { value: '7 EBI' } })
    await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/student-attendance/students?q=7+EBI&page=1&schoolYearId=sy1'))
  })
  it('justifica desde la falta con la fecha y el alumno precargados y refresca su historial', async () => {
    render(<StudentAttendanceRecord studentId="st1" student={student} initiallyAdding={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Justificar falta del 05/10/26' }))
    expect(screen.getByRole('heading', { name: 'Agregar licencia o justificativo para Ana' })).toBeInTheDocument()
    expect(screen.getAllByLabelText('Desde')[0]).toHaveValue('2026-10-05')
    fireEvent.click(screen.getByRole('button', { name: 'Licencia médica' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cargar justificativo' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 falta(s) ya marcadas'))
    const post = vi.mocked(api).mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/admin/student-attendance/justification-ranges')
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({ studentId: 'st1', fromYmd: '2026-10-05', toYmd: '2026-10-05', reason: 'Licencia médica' })
    expect(await screen.findByText('Falta justificada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Justificar falta del/ })).not.toBeInTheDocument()
  })
  it('los perfiles de lectura ven el historial y no pueden cargar ni justificar', async () => {
    state.canJustify = false
    render(<StudentAttendanceRecord studentId="st1" student={student} initiallyAdding={true} />)
    expect(await screen.findByText('Falta sin justificar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Agregar licencia|Justificar falta/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Licencias y justificativos' })).not.toBeInTheDocument()
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('justification-ranges'))).toBe(false)
  })
  it('mantiene la carga abierta si falla el guardado y no muestra éxito', async () => {
    const respond = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation((path, init) => init?.method === 'POST' ? Promise.reject(new Error('No se pudo guardar')) : respond(path, init))
    render(<StudentAttendanceRecord studentId="st1" student={student} initiallyAdding={true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Licencia médica' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cargar justificativo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar')
    expect(screen.getByRole('heading', { name: 'Agregar licencia o justificativo para Ana' })).toBeInTheDocument()
  })
})
