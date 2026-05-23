import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AdminShell, { adminRouteUsesSchoolYear } from './AdminShell'

const usePathnameMock = vi.fn(() => '/admin/users')

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}))

vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useAdminSchoolYear: () => ({
    loading: false,
    years: [{ id: 'sy-2026', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE' }],
    activeId: 'sy-2026',
    selectedId: 'sy-2026',
    allYears: false,
    setSelectedId: vi.fn(),
    setAllYears: vi.fn(),
    schoolYearQuery: 'schoolYearId=sy-2026',
  }),
}))

describe('AdminShell school-year filter visibility', () => {
  it('shows the school-year filter only for school-year scoped admin routes', () => {
    expect(adminRouteUsesSchoolYear('/admin/attendance')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/events/create')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/courses')).toBe(true)
    expect(adminRouteUsesSchoolYear('/admin/students')).toBe(true)

    expect(adminRouteUsesSchoolYear('/admin/users')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/settings')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/profiles')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/audit')).toBe(false)
    expect(adminRouteUsesSchoolYear('/admin/school-years')).toBe(false)
  })

  it('renders the school-year filter on scoped routes', () => {
    usePathnameMock.mockReturnValue('/admin/events')

    render(<AdminShell><div>Contenido</div></AdminShell>)

    expect(screen.getByText('Ciclo lectivo')).toBeInTheDocument()
    expect(screen.getByLabelText('Seleccionar ciclo lectivo')).toBeInTheDocument()
    expect(screen.getByText('schoolYearId=sy-2026')).toBeInTheDocument()
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })

  it('hides the school-year filter on global admin routes', () => {
    usePathnameMock.mockReturnValue('/admin/users')

    render(<AdminShell><div>Contenido global</div></AdminShell>)

    expect(screen.queryByText('Ciclo lectivo')).not.toBeInTheDocument()
    expect(screen.getByText('Contenido global')).toBeInTheDocument()
  })
})
