import { useOptionalAuth } from '@/contexts/AuthContext'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminCoursesPage from './page'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import type {
  CourseRow,
  CourseOrientationRow,
  OrientationRow,
  SubjectRow,
} from '@/components/admin/courses/course-types'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: vi.fn(() => ({
    me: {
      role: 'ADMIN',
      permissions: [{ id: 'courses.manage', scope: 'all' }],
    },
  })),
}))

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: vi.fn(),
}))

const mockedApi = vi.mocked(api)
const mockedYear = vi.mocked(useOptionalAdminSchoolYear)
const yearContext = {
  loading: false,
  years: [
    {
      id: 'y1',
      code: 2026,
      label: 'Ciclo 2026',
      status: 'ACTIVE',
      startsOn: null,
      endsOn: null,
      createdAt: '',
      updatedAt: '',
    },
  ],
  activeId: 'y1',
  selectedId: 'y1',
  allYears: false,
  schoolYearQuery: 'schoolYearId=y1',
  schoolYearScopedQuery: 'schoolYearId=y1',
  setSelectedId: vi.fn(),
  setAllYears: vi.fn(),
  reload: vi.fn(),
}
const course = (id: string, name: string, offered: boolean): CourseRow => ({
  id,
  name,
  code: id === 'c1' ? '1A' : id === 'c2' ? '2B' : '3C',
  level: id === 'c1' ? 'EMS' : 'EBI',
  sortOrder: Number(id.slice(1)),
  description: null,
  isActive: true,
  courseOfferingId: offered ? `offer-${id}` : null,
  offeringIsActive: offered,
  offeringIsOffered: offered,
})
const orientation = (id: string, name: string): OrientationRow => ({
  id,
  name,
  code: null,
  description: null,
  isActive: true,
  sortOrder: 1,
})
const subject = (
  id: string,
  name: string,
  orientationId: string | null = null,
  active = true,
): SubjectRow => ({
  id,
  name,
  code: 'MAT',
  description: 'Programa vigente',
  sortOrder: 3,
  isActive: active,
  courseId: 'c1',
  orientationId,
  associationType: orientationId ? 'ORIENTACION' : 'TRONCO_COMUN_CURSO',
  assignmentIsActive: active,
})
let courses: CourseRow[]
let catalog: OrientationRow[]
let orientations: CourseOrientationRow[]
let subjects: SubjectRow[]
const list = () =>
  screen.getByRole('complementary', { name: 'Catálogo de cursos' })
const detail = () => screen.getByRole('region', { name: 'Detalle del curso' })
async function selectFirst() {
  await screen.findByText('Primero')
  fireEvent.click(within(list()).getByRole('button', { name: /Primero/ }))
  await screen.findByText('Matemática')
}
async function manage() {
  await selectFirst()
  fireEvent.click(
    screen.getByRole('button', { name: /Gestionar orientaciones/ }),
  )
}
const mutations = () =>
  mockedApi.mock.calls.filter(([, options]) => options?.method)
const payload = (index = 0) => JSON.parse(mutations()[index][1]!.body as string)

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(useOptionalAuth).mockReturnValue({
    me: {
      role: 'ADMIN',
      permissions: [{ id: 'courses.manage', scope: 'all' }],
    },
    loading: false,
    error: false,
    refresh: vi.fn(),
  })
  mockedYear.mockReturnValue(yearContext)
  courses = [
    course('c1', 'Primero', true),
    course('c2', 'Segundo', true),
    course('c3', 'Tercero', false),
  ]
  catalog = [
    orientation('ori1', 'Científica'),
    orientation('ori2', 'Humanística'),
  ]
  orientations = [
    {
      id: 'co1',
      courseId: 'c1',
      orientationId: 'ori1',
      schoolYearId: 'y1',
      isActive: true,
      notes: null,
      orientation: catalog[0],
    },
  ]
  subjects = [
    subject('s1', 'Matemática'),
    subject('s2', 'Física', 'ori1'),
    subject('s3', 'Historia anterior', null, false),
  ]
  mockedApi.mockReset()
  mockedApi.mockImplementation(async (url, options) => {
    const path = String(url).split('?')[0]
    const body = options?.body ? JSON.parse(options.body as string) : null
    if (options?.method === 'PUT' && path === '/courses/c1') {
      courses = courses.map((row) =>
        row.id === 'c1'
          ? {
              ...row,
              offeringIsActive: body.offeringIsActive,
              offeringIsOffered: body.offeringIsActive,
            }
          : row,
      )
      return courses[0] as never
    }
    if (options?.method === 'POST' && path === '/courses') {
      const created = {
        ...course('c4', body.name, body.offerInSchoolYear),
        sortOrder: body.sortOrder,
      }
      courses.push(created)
      return created as never
    }
    if (options?.method === 'POST' && path === '/courses/orientations') {
      const created = orientation('ori-new', body.name)
      catalog.push(created)
      return created as never
    }
    if (options?.method === 'PUT' && path === '/courses/orientations/ori1') {
      catalog[0] = { ...catalog[0], name: body.name }
      orientations[0] = { ...orientations[0], orientation: catalog[0] }
      return catalog[0] as never
    }
    if (options?.method === 'POST' && path === '/courses/c1/orientations') {
      const existing = orientations.find(
        (row) => row.orientationId === body.orientationId,
      )
      if (existing)
        orientations = orientations.map((row) =>
          row.id === existing.id ? { ...row, isActive: body.isActive } : row,
        )
      else
        orientations.push({
          id: 'co-new',
          courseId: 'c1',
          orientationId: body.orientationId,
          schoolYearId: 'y1',
          isActive: true,
          notes: null,
          orientation: catalog.find((row) => row.id === body.orientationId)!,
        })
      return {} as never
    }
    if (options?.method === 'DELETE' && path === '/courses/c1/orientations/co1')
      orientations = []
    if (options?.method === 'POST' && path === '/courses/c1/subjects')
      subjects.push(subject('s-new', body.name, body.orientationId ?? null))
    if (options?.method === 'PUT' && path === '/courses/c1/subjects/s1')
      subjects[0] = { ...subjects[0], ...body }
    if (options?.method === 'DELETE' && path === '/courses/c1/subjects/s1')
      subjects = subjects.filter((row) => row.id !== 's1')
    if (options?.method) return {} as never
    if (path === '/courses/orientations') return [...catalog] as never
    if (path === '/courses/c1/orientations') return [...orientations] as never
    if (path === '/courses/c1/subjects') return [...subjects] as never
    if (path === '/courses') return [...courses] as never
    return [] as never
  })
})

describe('Catálogo de cursos simplificado', () => {
  it('lista todos los cursos con la creación y el detalle cerrados', async () => {
    render(<AdminCoursesPage />)
    expect(await screen.findByText('Primero')).toBeInTheDocument()
    expect(screen.getByText('Segundo')).toBeInTheDocument()
    expect(screen.getByText('Tercero')).toBeInTheDocument()
    expect(screen.getByText('Mostrando 3 de 3 cursos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByLabelText('Nombre del curso')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Seleccioná un curso' }),
    ).toBeInTheDocument()
  })

  it('combina búsqueda por nombre o código con los tres botones de oferta', async () => {
    render(<AdminCoursesPage />)
    await screen.findByText('Primero')
    fireEvent.click(screen.getByRole('button', { name: 'No ofertados' }))
    expect(within(list()).queryByText('Primero')).not.toBeInTheDocument()
    expect(within(list()).getByText('Tercero')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar curso'), {
      target: { value: ' 2b ' },
    })
    expect(screen.getByText(/Ningún curso coincide/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ofertados' }))
    expect(within(list()).getByText('Segundo')).toBeInTheDocument()
    expect(within(list()).queryByText('Primero')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar curso'), {
      target: { value: 'PRIMER' },
    })
    expect(within(list()).getByText('Primero')).toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

  it('permite limpiar una búsqueda sin resultados', async () => {
    render(<AdminCoursesPage />)
    await screen.findByText('Primero')
    fireEvent.change(screen.getByLabelText('Buscar curso'), {
      target: { value: 'zzz' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getByLabelText('Buscar curso')).toHaveValue('')
    expect(within(list()).getByText('Primero')).toBeInTheDocument()
  })

  it('muestra las asignaturas comunes y mantiene orientaciones e histórico cerrados', async () => {
    render(<AdminCoursesPage />)
    await selectFirst()
    expect(screen.queryByText('Física')).not.toBeInTheDocument()
    expect(screen.queryByText('Historia anterior')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Gestionar orientaciones/ }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('button', { name: 'Agregar orientación' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByLabelText('Ver asignaturas históricas'),
    ).not.toBeVisible()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('separa específicas, comunes heredadas e histórico', async () => {
    render(<AdminCoursesPage />)
    await selectFirst()
    fireEvent.change(screen.getByLabelText('Ver asignaturas'), {
      target: { value: 'co1' },
    })
    expect(screen.getByText('Física')).toBeInTheDocument()
    expect(screen.getByText('Matemática')).not.toBeVisible()
    fireEvent.click(screen.getByText(/Comunes heredadas/))
    expect(screen.getByText('Matemática')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Ver asignaturas'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByText('Más opciones'))
    fireEvent.click(screen.getByLabelText('Ver asignaturas históricas'))
    expect(screen.getByText('Historia anterior')).toBeVisible()
    expect(screen.getByText('Inactiva')).toBeVisible()
  })

  it('reinicia formularios y opciones al elegir otro curso', async () => {
    render(<AdminCoursesPage />)
    await manage()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar asignatura' }))
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Borrador anterior' },
    })
    fireEvent.click(within(list()).getByRole('button', { name: /Segundo/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Asignaturas comunes/ }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByDisplayValue('Borrador anterior'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Gestionar orientaciones/ }),
    ).toHaveAttribute('aria-expanded', 'false')
  })

  it('actualiza la oferta del ciclo seleccionado desde el detalle', async () => {
    render(<AdminCoursesPage />)
    await selectFirst()
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(screen.getByRole('switch')).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    )
    expect(mutations()[0][0]).toBe('/courses/c1?schoolYearId=y1')
    expect(payload()).toEqual({ offeringIsActive: false })
  })

  it('permite volver al listado conservando la búsqueda y el filtro', async () => {
    render(<AdminCoursesPage />)
    await selectFirst()
    fireEvent.change(screen.getByLabelText('Buscar curso'), {
      target: { value: 'Primer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ofertados' }))
    fireEvent.click(screen.getByRole('button', { name: 'Volver a cursos' }))
    expect(screen.getByLabelText('Buscar curso')).toHaveValue('Primer')
    expect(screen.getByRole('button', { name: 'Ofertados' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText('Matemática')).not.toBeInTheDocument()
    expect(within(list()).getByText('Primero')).toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

  it('ofrece creación con nombre, orden y el ciclo seleccionado', async () => {
    render(<AdminCoursesPage />)
    await screen.findByText('Primero')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo curso' }))
    fireEvent.change(screen.getByLabelText('Nombre del curso'), {
      target: { value: ' Cuarto ' },
    })
    fireEvent.change(screen.getByLabelText('Orden en el listado'), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear curso' }))
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Nombre del curso'),
      ).not.toBeInTheDocument(),
    )
    expect(payload()).toEqual({
      name: 'Cuarto',
      sortOrder: 4,
      isActive: true,
      offerInSchoolYear: true,
      schoolYearId: 'y1',
    })
    expect(
      within(detail()).getByRole('heading', { name: 'Cuarto' }),
    ).toBeInTheDocument()
  })

  it('permite cancelar la creación sin enviar datos', async () => {
    render(<AdminCoursesPage />)
    await screen.findByText('Primero')
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo curso' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Nombre del curso')).not.toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  })

  it('en todos los ciclos permite crear en catálogo y deshabilita cambios de oferta', async () => {
    mockedYear.mockReturnValue({
      ...yearContext,
      allYears: true,
      selectedId: null,
      schoolYearQuery: 'allYears=1',
    })
    render(<AdminCoursesPage />)
    await selectFirst()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ofertados' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'No ofertados' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo curso' }))
    expect(screen.getByRole('checkbox', { name: /Ofertar en/ })).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: /Ofertar en/ }),
    ).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('Nombre del curso'), {
      target: { value: 'Cuarto' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear curso' }))
    await waitFor(() => expect(mutations()).toHaveLength(1))
    expect(payload()).toMatchObject({ offerInSchoolYear: false })
    expect(payload()).not.toHaveProperty('schoolYearId')
  })
})

describe('Orientaciones y asignaturas', () => {
  it('agrupa acciones y permite editar el nombre de una orientación', async () => {
    render(<AdminCoursesPage />)
    await manage()
    expect(
      screen.queryByRole('button', { name: 'Editar nombre' }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Más acciones de orientación Científica',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Editar nombre' }))
    fireEvent.change(screen.getByLabelText('Nombre de la orientación'), {
      target: { value: 'Ciencias' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Nombre de la orientación'),
      ).not.toBeInTheDocument(),
    )
    expect(mutations()[0][0]).toBe('/courses/orientations/ori1')
    expect(payload()).toEqual({ name: 'Ciencias' })
  })

  it('conserva el ciclo al desactivar una orientación', async () => {
    render(<AdminCoursesPage />)
    await manage()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Más acciones de orientación Científica',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Desactivar en el curso' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Orientación desactivada',
      ),
    )
    expect(mutations()[0][0]).toBe(
      '/courses/c1/orientations?all=1&includeNotOffered=1&schoolYearId=y1',
    )
    expect(payload()).toEqual({ orientationId: 'ori1', isActive: false })
  })

  it('distingue quitar del curso de eliminar del catálogo y respeta la confirmación', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<AdminCoursesPage />)
    await manage()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Más acciones de orientación Científica',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Eliminar del catálogo' }),
    )
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('También se ocultará de los cursos'),
    )
    expect(mutations()).toHaveLength(0)
    confirm.mockReturnValue(true)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Más acciones de orientación Científica',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Quitar del curso' }))
    await waitFor(() =>
      expect(
        screen.getByText('Este curso no tiene orientaciones.'),
      ).toBeInTheDocument(),
    )
    expect(mutations()[0][0]).toBe(
      '/courses/c1/orientations/co1?all=1&includeNotOffered=1&schoolYearId=y1',
    )
    expect(mutations()[0][1]?.method).toBe('DELETE')
  })

  it('agrega una orientación del catálogo con el formulario a pedido', async () => {
    render(<AdminCoursesPage />)
    await manage()
    expect(
      screen.queryByLabelText('Orientación del catálogo'),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar orientación' }))
    fireEvent.change(screen.getByLabelText('Orientación del catálogo'), {
      target: { value: 'ori2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar al curso' }))
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Orientación del catálogo'),
      ).not.toBeInTheDocument(),
    )
    expect(payload()).toEqual({ orientationId: 'ori2', isActive: true })
    expect(
      screen.getByRole('option', { name: 'Humanística' }),
    ).toBeInTheDocument()
  })

  it('crea una orientación y luego la asocia al curso', async () => {
    render(<AdminCoursesPage />)
    await manage()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar orientación' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear nueva' }))
    fireEvent.change(screen.getByLabelText('Nueva orientación'), {
      target: { value: ' Arte ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Crear y agregar' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Orientación creada y agregada',
      ),
    )
    expect(mutations()).toHaveLength(2)
    expect(mutations()[0][0]).toBe('/courses/orientations')
    expect(payload(0)).toEqual({ name: 'Arte', isActive: true })
    expect(payload(1)).toEqual({ orientationId: 'ori-new', isActive: true })
  })

  it.each([
    ['', 'Nueva común', 'TRONCO_COMUN_CURSO'],
    ['co1', 'Nueva específica', 'ORIENTACION'],
  ])(
    'agrega asignaturas al ámbito correcto (%s)',
    async (selected, name, type) => {
      render(<AdminCoursesPage />)
      await selectFirst()
      if (selected)
        fireEvent.change(screen.getByLabelText('Ver asignaturas'), {
          target: { value: selected },
        })
      fireEvent.click(
        screen.getByRole('button', {
          name: selected ? 'Agregar específica' : 'Agregar asignatura',
        }),
      )
      fireEvent.change(screen.getByLabelText('Nombre'), {
        target: { value: name },
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Guardar asignatura' }),
      )
      await screen.findByText(name)
      expect(mutations()[0][0]).toBe(
        '/courses/c1/subjects?all=1&includeNotOffered=1&schoolYearId=y1',
      )
      expect(payload()).toEqual({
        name,
        sortOrder: 0,
        isActive: true,
        associationType: type,
        ...(selected ? { orientationId: 'ori1' } : {}),
      })
    },
  )

  it('edita asignaturas conservando sus demás datos', async () => {
    render(<AdminCoursesPage />)
    await selectFirst()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Matemática' }))
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Matemáticas' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await screen.findByText('Matemáticas')
    expect(payload()).toEqual({
      name: 'Matemáticas',
      code: 'MAT',
      description: 'Programa vigente',
      sortOrder: 3,
      isActive: true,
    })
  })

  it('mantiene confirmación antes de quitar una asignatura desde el menú', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdminCoursesPage />)
    await selectFirst()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Más acciones de asignatura Matemática',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Quitar del plan' }))
    await waitFor(() =>
      expect(screen.queryByText('Matemática')).not.toBeInTheDocument(),
    )
    expect(window.confirm).toHaveBeenCalledWith(
      '¿Eliminar esta asignatura del plan?',
    )
    expect(mutations()[0][0]).toBe(
      '/courses/c1/subjects/s1?all=1&includeNotOffered=1&schoolYearId=y1',
    )
  })
})

it.each([
  'TEACHER',
  'STAFF',
  'ADSCRIPTO',
  'DIRECCION',
  'INSPECCION',
  'COORDINADOR',
])(
  'ofrece el catálogo sin acciones de escritura a %s con permiso de lectura',
  async (role) => {
    vi.mocked(useOptionalAuth).mockReturnValue({
      me: { role, permissions: [{ id: 'courses.read', scope: 'all' }] },
      loading: false,
      error: false,
      refresh: vi.fn(),
    })
    render(<AdminCoursesPage />)
    await selectFirst()
    expect(
      screen.queryByRole('button', {
        name: /Nuevo curso|Agregar asignatura|Gestionar orientaciones|Más acciones/,
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Orientaciones/ }))
    expect(within(document.getElementById('course-orientations')!).getByRole('button', { name: /Científica/ })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /Agregar orientación|Más acciones|Crear orientación/,
      }),
    ).not.toBeInTheDocument()
    expect(mutations()).toHaveLength(0)
  },
)
