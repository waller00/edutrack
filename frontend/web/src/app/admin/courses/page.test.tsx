import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminCoursesPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => null,
}))
// SubjectListBlock no es relevante para estos tests del listado de cursos.
vi.mock('@/components/admin/courses/SubjectListBlock', () => ({ default: () => <div data-testid="subject-block" /> }))

const mockedApi = vi.mocked(api)

const courses = [
  { id: 'c1', name: 'Primero', code: '1', level: 'EBI', sortOrder: 1, description: null, isActive: true, courseOfferingId: 'o1', offeringIsActive: true, offeringIsOffered: true },
  { id: 'c2', name: 'Segundo', code: '2', level: 'EBI', sortOrder: 2, description: null, isActive: true, courseOfferingId: 'o2', offeringIsActive: true, offeringIsOffered: true },
]

describe('AdminCoursesPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('/courses/orientations')) return [] as never
      if (String(url).includes('/courses')) return courses as never
      return [] as never
    })
  })

  it('lista los cursos del catálogo', async () => {
    render(<AdminCoursesPage />)
    expect(await screen.findByText('Primero')).toBeInTheDocument()
    expect(screen.getByText('Segundo')).toBeInTheDocument()
  })

  it('filtra el catálogo con el buscador', async () => {
    render(<AdminCoursesPage />)
    await screen.findByText('Primero')

    fireEvent.change(screen.getByLabelText('Buscar curso'), { target: { value: 'segund' } })

    await waitFor(() => expect(screen.queryByText('Primero')).not.toBeInTheDocument())
    expect(screen.getByText('Segundo')).toBeInTheDocument()
  })

  it('muestra mensaje cuando ningún curso coincide', async () => {
    render(<AdminCoursesPage />)
    await screen.findByText('Primero')

    fireEvent.change(screen.getByLabelText('Buscar curso'), { target: { value: 'zzz' } })

    expect(await screen.findByText(/Ningún curso coincide/)).toBeInTheDocument()
  })
})
