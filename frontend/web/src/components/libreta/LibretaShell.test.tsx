import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LibretaShell from './LibretaShell'
import { LibretaProvider } from '@/contexts/LibretaContext'
import { LIBRETA_SECTIONS } from '@/lib/libreta/menu'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
// Tiene su propia consulta y sus propios tests: acá sólo interesa que el marco lo monte.
vi.mock('./GroupSwitcher', () => ({ default: () => <div>selector de grupo</div> }))
const mockedApi = vi.mocked(api)

const pathname = vi.fn(() => '/libreta/gb-1/planificacion')
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }))

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
  })

  it('muestra la identidad de la libreta en el encabezado', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()

    expect(await screen.findByRole('heading', { name: /Libreta: 1-EMS · FÍSICA/ })).toBeInTheDocument()
    expect(screen.getByText(/tronco común/)).toBeInTheDocument()
    expect(screen.getByText(/22 estudiantes/)).toBeInTheDocument()
  })

  it('nombra la orientación cuando la libreta la tiene', async () => {
    mockedApi.mockResolvedValue({ ...DETAIL, orientation: 'Ciencias de la Vida' })

    renderShell()

    expect(await screen.findByText(/— Ciencias de la Vida/)).toBeInTheDocument()
  })

  it('lista todas las secciones con su explicación', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()

    const nav = await screen.findByRole('navigation', { name: 'Secciones de la libreta' })
    for (const section of LIBRETA_SECTIONS) {
      expect(within(nav).getByText(section.label)).toBeInTheDocument()
      expect(within(nav).getByText(section.hint)).toBeInTheDocument()
    }
  })

  it('marca la sección abierta con aria-current', async () => {
    mockedApi.mockResolvedValue(DETAIL)
    pathname.mockReturnValue('/libreta/gb-1/visados')

    renderShell()

    const current = await screen.findByRole('link', { current: 'page' })
    expect(current).toHaveTextContent('Visados')
  })

  it('avisa que un ciclo cerrado es sólo consulta', async () => {
    mockedApi.mockResolvedValue({ ...DETAIL, status: 'ARCHIVED' })

    renderShell()

    expect(await screen.findByText(/Ciclo lectivo cerrado/)).toBeInTheDocument()
  })

  it('no muestra el aviso de histórico en un ciclo abierto', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()
    await screen.findByRole('heading', { name: /Libreta:/ })

    expect(screen.queryByText(/Ciclo lectivo cerrado/)).not.toBeInTheDocument()
  })

  it('ante un error ofrece la vuelta a Mis Libretas en lugar de dejar el marco vacío', async () => {
    mockedApi.mockRejectedValue(new Error('No asignada'))

    renderShell()

    expect(await screen.findByRole('alert')).toHaveTextContent('No asignada')
    expect(screen.getByRole('link', { name: /Volver a Mis Libretas/ })).toBeInTheDocument()
    expect(screen.queryByText('contenido de la sección')).not.toBeInTheDocument()
  })

  it('renderiza la sección hija cuando la libreta cargó', async () => {
    mockedApi.mockResolvedValue(DETAIL)

    renderShell()

    expect(await screen.findByText('contenido de la sección')).toBeInTheDocument()
  })
})
