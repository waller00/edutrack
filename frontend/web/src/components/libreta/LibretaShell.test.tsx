import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LibretaShell from './LibretaShell'
import { LibretaProvider } from '@/contexts/LibretaContext'
import { sectionsFor } from '@/lib/libreta/menu'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
// Tiene su propia consulta y sus propios tests: acá sólo interesa que el marco lo monte.
vi.mock('./GroupSwitcher', () => ({ default: () => <div>selector de grupo</div> }))
const mockedApi = vi.mocked(api)

const pathname = vi.fn(() => '/libreta/gb-1/planificacion')
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => pathname(), useRouter: () => ({ push, replace }) }))

// Quien mira: por defecto el docente; los tests de Dirección le dan permisos de supervisión.
const me = vi.fn<() => unknown>(() => ({ permissions: [] }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => ({ me: me() }) }))
const DIRECCION_ME = {
  permissions: [
    { id: 'gradebook.read', scope: 'all' },
    { id: 'gradebook.review', scope: 'all' },
    { id: 'gradebook.endorse', scope: 'all' },
  ],
}

const DETAIL = {
  id: 'gb-1',
  status: 'ACTIVE' as const,
  schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
  course: { id: 'c-1', name: 'Primero', code: '1-EMS', level: 'EMS' as const },
  courseOfferingId: 'off-1',
  orientation: null,
  subject: { id: 'sub-1', name: 'Física', code: 'FIS' },
  teacher: { id: 'u-1', name: 'Ana Benítez', username: 'abenitez' },
  access: { level: 'OWNER' as const, canGrade: true },
  studentCount: 22,
  students: [],
}

function renderShell() {
  return render(
    <LibretaProvider gradeBookId="gb-1">
      <LibretaShell>
        <p>contenido de la sección</p>
      </LibretaShell>
    </LibretaProvider>,
  )
}

describe('<LibretaShell />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pathname.mockReturnValue('/libreta/gb-1/planificacion')
    me.mockReturnValue({ permissions: [] })
  })

  it('muestra la identidad de la libreta en el encabezado', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()

    expect(await screen.findByRole('heading', { name: 'Física' })).toBeInTheDocument()
    expect(screen.getByText(/tronco común/)).toBeInTheDocument()
    expect(screen.getByText(/22 estudiantes/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lista del grupo' })).toHaveAttribute('href', '/libreta/gb-1')
  })

  it('al suplente le muestra sólo sus notas y hasta cuándo dura la suplencia', async () => {
    pathname.mockReturnValue('/libreta/gb-1/evaluaciones')
    mockedApi.mockResolvedValue({
      ...DETAIL,
      access: { level: 'SUBSTITUTE', canGrade: true, ownWorkOnly: true, substituteUntil: '2026-06-13T02:59:59.999Z' },
    })

    renderShell()

    const nav = await screen.findByRole('navigation', { name: 'Secciones de la libreta' })
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
    expect(within(nav).getByRole('link', { name: /Tus notas \(suplencia\)/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Suplencia\..*hasta el 12\/06\/2026.*titular no se muestra/)
  })

  it('el suplente que llega a otra sección por la URL vuelve a la portada', async () => {
    pathname.mockReturnValue('/libreta/gb-1/planificacion')
    mockedApi.mockResolvedValue({
      ...DETAIL,
      access: { level: 'SUBSTITUTE', canGrade: true, ownWorkOnly: true, substituteUntil: null },
    })

    renderShell()

    await screen.findByRole('navigation', { name: 'Secciones de la libreta' })
    expect(replace).toHaveBeenCalledWith('/libreta/gb-1')
    expect(screen.queryByText('contenido de la sección')).not.toBeInTheDocument()
  })

  it('nombra la orientación cuando la libreta la tiene', async () => {
    mockedApi.mockResolvedValue({ ...DETAIL, orientation: 'Ciencias de la Vida' })

    renderShell()

    expect(await screen.findByText(/— Ciencias de la Vida/)).toBeInTheDocument()
  })

  it('al docente le lista sus secciones con su explicación, sin sección de mensajes', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()

    const nav = await screen.findByRole('navigation', { name: 'Secciones de la libreta' })
    for (const section of sectionsFor({ supervises: false })) {
      expect(within(nav).getByText(section.label)).toBeInTheDocument()
      expect(within(nav).getByText(section.hint)).toBeInTheDocument()
    }
    expect(within(nav).queryByText('Mensajes de Dirección y Adscripción')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Visado y seguimiento')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Inasistencias')).not.toBeInTheDocument()
  })

  it('a Dirección le muestra el visado', async () => {
    me.mockReturnValue(DIRECCION_ME)
    mockedApi.mockResolvedValue({ ...DETAIL, access: { level: 'SUPERVISION', canGrade: false, canPlan: false } })

    renderShell()

    const nav = await screen.findByRole('navigation', { name: 'Secciones de la libreta' })
    expect(within(nav).getByText('Visado y seguimiento')).toBeInTheDocument()
  })

  it('el docente que abre el visado vuelve a la portada de su libreta', async () => {
    mockedApi.mockResolvedValue(DETAIL)
    pathname.mockReturnValue('/libreta/gb-1/visado')

    renderShell()

    await screen.findByRole('heading', { name: 'Física' })
    expect(replace).toHaveBeenCalledWith('/libreta/gb-1')
    expect(screen.queryByText('contenido de la sección')).not.toBeInTheDocument()
  })

  it('marca la sección abierta con aria-current', async () => {
    mockedApi.mockResolvedValue(DETAIL)
    pathname.mockReturnValue('/libreta/gb-1/cierre')

    renderShell()

    const current = await screen.findByRole('link', { current: 'page' })
    expect(current).toHaveTextContent('Cierre de períodos')
  })

  it('avisa que un ciclo cerrado es sólo consulta', async () => {
    mockedApi.mockResolvedValue({ ...DETAIL, status: 'ARCHIVED' })

    renderShell()

    expect(await screen.findByText(/Ciclo lectivo cerrado/)).toBeInTheDocument()
  })

  it('no muestra el aviso de histórico en un ciclo abierto', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()
    await screen.findByRole('heading', { name: 'Física' })

    expect(screen.queryByText(/Ciclo lectivo cerrado/)).not.toBeInTheDocument()
  })

  it('ante un error ofrece la vuelta a las libretas en lugar de dejar el marco vacío', async () => {
    mockedApi.mockRejectedValue(new Error('No asignada'))

    renderShell()

    expect(await screen.findByRole('alert')).toHaveTextContent('No asignada')
    expect(screen.getByRole('link', { name: /Volver a las libretas/ })).toBeInTheDocument()
    expect(screen.queryByText('contenido de la sección')).not.toBeInTheDocument()
  })

  it('renderiza la sección hija cuando la libreta cargó', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()

    expect(await screen.findByText('contenido de la sección')).toBeInTheDocument()
  })

  it('contrae y vuelve a expandir el menú lateral', async () => {
    mockedApi.mockResolvedValue(DETAIL)
    const { fireEvent } = await import('@testing-library/react')

    renderShell()
    await screen.findByText('Menú Libro del Profesor')

    fireEvent.click(screen.getByRole('button', { name: /Contraer menú del Libro del Profesor/ }))

    const nav = screen.getByRole('navigation', { name: 'Secciones de la libreta' })
    expect(screen.queryByText('Menú Libro del Profesor')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Planificación')).not.toBeInTheDocument()
    // Contraído no queda vacío: la abreviatura sigue llevando a la sección.
    expect(within(nav).getByRole('link', { name: 'Planificación' })).toHaveTextContent('Plan')
    expect(screen.getByRole('button', { name: /Expandir menú del Libro del Profesor/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    fireEvent.click(screen.getByRole('button', { name: /Expandir menú del Libro del Profesor/ }))

    expect(screen.getByText('Menú Libro del Profesor')).toBeInTheDocument()
    expect(within(nav).getByText('Planificación')).toBeInTheDocument()
  })

  it('en el celular, un selector lleva a cada sección', async () => {
    mockedApi.mockResolvedValue(DETAIL)
    const { fireEvent } = await import('@testing-library/react')

    renderShell()
    const select = await screen.findByLabelText('Sección de la libreta')
    expect(select).toHaveValue('planificacion')

    fireEvent.change(select, { target: { value: 'cierre' } })
    expect(push).toHaveBeenCalledWith('/libreta/gb-1/cierre')
  })
})
