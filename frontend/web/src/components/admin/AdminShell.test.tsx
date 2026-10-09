import { useOptionalAuth } from '@/contexts/AuthContext'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AdminShell, { adminRouteUsesSchoolYear } from './AdminShell'
import { SidebarSlotContext } from '@/components/navigation/sidebar-slot'

const usePathnameMock = vi.fn(() => '/admin/users')
const setAllYearsMock = vi.hoisted(() => vi.fn())

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: vi.fn(() => ({
    me: {
      role: 'ADMIN',
      permissions: [{ id: 'school-years.manage', scope: 'all' }],
    },
  })),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}))

vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useAdminSchoolYear: () => ({
    loading: false,
    years: [
      { id: 'sy-2026', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE' },
    ],
    activeId: 'sy-2026',
    selectedId: 'sy-2026',
    allYears: false,
    setSelectedId: vi.fn(),
    setAllYears: setAllYearsMock,
    schoolYearQuery: 'schoolYearId=sy-2026',
  }),
}))

describe('AdminShell school-year filter visibility', () => {
  it('shows the school-year filter only for school-year scoped admin routes', () => {
    expect(adminRouteUsesSchoolYear('/admin/attendance')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/events/create')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/courses')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/students')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/analytics')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/licenses')).toBe(true)

    expect(adminRouteUsesSchoolYear('/admin/users')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/settings')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/profiles')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/audit')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/school-years')).toBe(false)
  })

  it('renders the school-year filter on scoped routes', () => {
    usePathnameMock.mockReturnValue('/admin/events')

    render(
      <AdminShell>
        <div>Contenido</div>
      </AdminShell>,
    )

    expect(screen.getByText('Ciclo lectivo')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Seleccionar ciclo lectivo'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Filtro API:')).not.toBeInTheDocument()
    expect(screen.queryByText('schoolYearId=sy-2026')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Gestionar ciclos' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })

  it('hides the school-year filter on global admin routes', () => {
    usePathnameMock.mockReturnValue('/admin/users')

    render(
      <AdminShell>
        <div>Contenido global</div>
      </AdminShell>,
    )

    expect(screen.queryByText('Ciclo lectivo')).not.toBeInTheDocument()
    expect(screen.getByText('Contenido global')).toBeInTheDocument()
  })
})

describe('AdminShell: ciclo lectivo en el menú lateral', () => {
  function renderWithSlot(rail = false, expand = vi.fn()) {
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    const view = render(
      <SidebarSlotContext.Provider value={{ slot, rail, expand }}>
        <AdminShell>
          <div>Contenido</div>
        </AdminShell>
      </SidebarSlotContext.Provider>,
    )
    return { slot, view, expand }
  }

  it('con menú, el selector va al menú y la línea de arriba queda sólo para el celular', () => {
    usePathnameMock.mockReturnValue('/admin/licenses')
    const { slot } = renderWithSlot()

    expect(within(slot).getByLabelText('Ciclo lectivo')).toHaveValue('sy-2026')
    expect(
      within(slot).getByRole('link', { name: 'Gestionar ciclos' }),
    ).toBeInTheDocument()
    // La línea de arriba sigue para el celular, oculta en escritorio.
    expect(
      screen.getByLabelText('Seleccionar ciclo lectivo').closest('div.border-b')
        ?.className,
    ).toContain('lg:hidden')
  })

  it('"Todos los ciclos" es una opción del selector', () => {
    usePathnameMock.mockReturnValue('/admin/licenses')
    const { slot } = renderWithSlot()

    fireEvent.change(within(slot).getByLabelText('Ciclo lectivo'), {
      target: { value: '__all__' },
    })
    expect(setAllYearsMock).toHaveBeenCalledWith(true)
  })

  it('con el menú contraído queda el año, y el clic abre el menú', () => {
    usePathnameMock.mockReturnValue('/admin/licenses')
    const { slot, expand } = renderWithSlot(true)

    const button = within(slot).getByRole('button', {
      name: /Ciclo lectivo: 2026/,
    })
    expect(button).toHaveTextContent('2026')
    fireEvent.click(button)
    expect(expand).toHaveBeenCalled()
  })

  it('en una pantalla que no filtra por ciclo, el menú no muestra selector', () => {
    usePathnameMock.mockReturnValue('/admin/users')
    const { slot } = renderWithSlot()
    expect(slot).toBeEmptyDOMElement()
  })
})

it('permite seleccionar el ciclo sin ofrecer su gestión a un docente', () => {
  vi.mocked(useOptionalAuth).mockReturnValueOnce({
    me: {
      role: 'TEACHER',
      permissions: [{ id: 'courses.read', scope: 'all' }],
    },
    loading: false,
    error: false,
    refresh: vi.fn(),
  })
  usePathnameMock.mockReturnValue('/admin/courses')
  render(<AdminShell>Consulta</AdminShell>)
  expect(screen.getByLabelText('Seleccionar ciclo lectivo')).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Gestionar ciclos' }),
  ).not.toBeInTheDocument()
})
