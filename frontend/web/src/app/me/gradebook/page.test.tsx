import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MyGradeBooksPage from './page'
import GradeBookPage from './[id]/page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const HEADER = {
  id: 'gb-1',
  status: 'ACTIVE',
  schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
  course: { id: 'c-1', name: '3 EMS', code: '3EMS', level: 'EMS' },
  courseOfferingId: 'off-1',
  orientation: 'Ciencia y Tecnología',
  subject: { id: 's-1', name: 'Matemática', code: 'MAT' },
  teacher: { id: 't-1', name: 'Ana G', username: 'ana.g' },
}

beforeEach(() => mockedApi.mockReset())

describe('MyGradeBooksPage', () => {
  it('agrupa las libretas por curso', async () => {
    mockedApi.mockResolvedValue({
      data: [
        HEADER,
        { ...HEADER, id: 'gb-2', course: { id: 'c-2', name: '7 EBI', code: '7EBI', level: 'EBI' }, orientation: null },
      ],
    } as any)

    render(<MyGradeBooksPage />)

    expect(await screen.findByRole('heading', { name: '3 EMS' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '7 EBI' })).toBeInTheDocument()
  })

  it('muestra la orientación, que es lo que distingue dos libretas del mismo curso', async () => {
    mockedApi.mockResolvedValue({ data: [HEADER] } as any)
    render(<MyGradeBooksPage />)
    expect(await screen.findByText('Matemática · 3 EMS — Ciencia y Tecnología')).toBeInTheDocument()
  })

  it('explica el vacío en vez de mostrar una pantalla en blanco', async () => {
    mockedApi.mockResolvedValue({ data: [] } as any)
    render(<MyGradeBooksPage />)
    expect(await screen.findByText(/No tenés libretas asignadas/)).toBeInTheDocument()
  })

  it('informa el error de carga', async () => {
    mockedApi.mockRejectedValue(new Error('API 500'))
    render(<MyGradeBooksPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('API 500')
  })
})

describe('GradeBookPage', () => {
  const OPTIONS = { periods: [], scales: [], activityTypes: [] }

  /**
   * El detalle monta además el panel de evaluaciones, que pide su propio listado y sus opciones.
   * El mock enruta por URL para que la página se ejercite como en producción.
   */
  function routeApi(detail: unknown) {
    mockedApi.mockImplementation(async (url: string) => {
      const path = String(url)
      if (path.includes('/assessments')) return { data: [] } as any
      if (path.includes('/options')) return OPTIONS as any
      if (path.includes('/messages')) return { data: [] } as any
      if (path.includes('/periods')) return { data: [] } as any
      if (path.includes('/moodle/preview')) throw new Error('Moodle no configurado en tests')
      return detail as any
    })
  }

  const DETAIL = {
    ...HEADER,
    access: { level: 'OWNER', canGrade: true },
    studentCount: 2,
    students: [
      { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Benítez', documentId: '1.234.567-8' },
      { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'Cardozo', documentId: null },
    ],
  }

  it('muestra el encabezado completo (RF-021)', async () => {
    routeApi(DETAIL)
    render(<GradeBookPage params={{ id: 'gb-1' }} />)

    expect(await screen.findByText('2026')).toBeInTheDocument()
    expect(screen.getByText('Ciencia y Tecnología')).toBeInTheDocument()
    expect(screen.getByText('Ana G')).toBeInTheDocument()
    expect(screen.getByText('Titular')).toBeInTheDocument()
  })

  it('dice "Tronco común" cuando la libreta no tiene orientación', async () => {
    routeApi({ ...DETAIL, orientation: null })
    render(<GradeBookPage params={{ id: 'gb-1' }} />)
    expect(await screen.findByText('Tronco común')).toBeInTheDocument()
  })

  it('lista el grupo con apellido primero', async () => {
    routeApi(DETAIL)
    render(<GradeBookPage params={{ id: 'gb-1' }} />)
    expect(await screen.findByText('Benítez, Ana')).toBeInTheDocument()
    expect(screen.getByText('Cardozo, Beto')).toBeInTheDocument()
  })

  it('avisa que el ciclo cerrado pasó a histórico y explica cómo modificarlo', async () => {
    routeApi({ ...DETAIL, status: 'ARCHIVED', access: { level: 'OWNER', canGrade: false } })
    render(<GradeBookPage params={{ id: 'gb-1' }} />)

    expect(await screen.findByText(/La libreta pasó a histórico/)).toBeInTheDocument()
    expect(screen.getByText(/reabrir el ciclo desde administración/)).toBeInTheDocument()
  })

  it('en un ciclo histórico el intercambio queda como registro, sin caja de escritura', async () => {
    routeApi({ ...DETAIL, status: 'ARCHIVED', access: { level: 'OWNER', canGrade: false } })
    render(<GradeBookPage params={{ id: 'gb-1' }} />)

    expect(await screen.findByText(/no admite mensajes nuevos/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Escribir un mensaje')).not.toBeInTheDocument()
  })

  it('un ciclo activo sí deja escribir', async () => {
    routeApi(DETAIL)
    render(<GradeBookPage params={{ id: 'gb-1' }} />)
    expect(await screen.findByLabelText('Escribir un mensaje')).toBeInTheDocument()
  })

  it('ante un 403 muestra el mensaje y una vuelta a la lista', async () => {
    mockedApi.mockRejectedValue(new Error('No tenés acceso a esta libreta.'))
    render(<GradeBookPage params={{ id: 'gb-1' }} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés acceso')
    expect(screen.getByRole('link', { name: /Volver a mis libretas/ })).toBeInTheDocument()
  })

  it('pide la libreta por su id', async () => {
    routeApi(DETAIL)
    render(<GradeBookPage params={{ id: 'gb-9' }} />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-9'))
  })
})
