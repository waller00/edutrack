import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MisLibretas, { filterLibretas, libretaCode } from './MisLibretas'
import { api } from '@/lib/api/client'
import type { GradeBookHeader } from '@/lib/gradebook/types'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const scope = vi.hoisted(() => ({ query: '' }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => ({ schoolYearScopedQuery: scope.query }),
}))
const mockedApi = vi.mocked(api)

function book(over: Partial<GradeBookHeader> = {}): GradeBookHeader {
  return {
    id: 'gb-1',
    status: 'ACTIVE',
    schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
    course: { id: 'c-1', name: 'Primero', code: '1-EMS', level: 'EMS' },
    courseOfferingId: 'off-1',
    orientation: null,
    subject: { id: 'sub-1', name: 'Física', code: 'FIS' },
    teacher: { id: 'u-1', name: 'Ana Benítez', username: 'abenitez' },
    ...over,
  }
}

describe('libretaCode', () => {
  it('usa el código del curso y la asignatura en mayúsculas', () => {
    expect(libretaCode(book())).toBe('1-EMS · FÍSICA')
  })

  it('intercala la orientación cuando la libreta la tiene', () => {
    expect(libretaCode(book({ orientation: 'Ciencias de la Vida' }))).toBe(
      '1-EMS Ciencias de la Vida · FÍSICA',
    )
  })

  it('cae al nombre del curso si no hay código', () => {
    expect(libretaCode(book({ course: { id: 'c-1', name: 'Séptimo', code: null, level: 'EBI' } })))
      .toBe('Séptimo · FÍSICA')
  })
})

describe('filterLibretas', () => {
  const books = [
    book({ id: 'a', subject: { id: 's1', name: 'Física', code: null } }),
    book({
      id: 'b',
      subject: { id: 's2', name: 'Matemática', code: null },
      teacher: { id: 'u-2', name: 'Carlos Díaz', username: 'cdiaz' },
    }),
    book({ id: 'c', subject: { id: 's3', name: 'Historia', code: null }, teacher: null }),
  ]
  const none = { libreta: '', asignatura: '', docente: '' }

  it('sin filtros devuelve todo', () => {
    expect(filterLibretas(books, none)).toHaveLength(3)
  })

  it('ignora acentos y mayúsculas', () => {
    expect(filterLibretas(books, { ...none, asignatura: 'fisica' }).map((b) => b.id)).toEqual(['a'])
    expect(filterLibretas(books, { ...none, asignatura: 'MATEMATICA' }).map((b) => b.id)).toEqual(['b'])
  })

  it('ignora espacios sobrantes', () => {
    expect(filterLibretas(books, { ...none, asignatura: '  historia  ' }).map((b) => b.id)).toEqual(['c'])
  })

  it('filtra por docente y no rompe con libretas sin titular', () => {
    expect(filterLibretas(books, { ...none, docente: 'díaz' }).map((b) => b.id)).toEqual(['b'])
  })

  it('combina los tres campos', () => {
    expect(filterLibretas(books, { libreta: '1-EMS', asignatura: 'fis', docente: 'ana' }).map((b) => b.id))
      .toEqual(['a'])
    expect(filterLibretas(books, { libreta: '1-EMS', asignatura: 'fis', docente: 'carlos' })).toHaveLength(0)
  })
})

describe('búsqueda general', () => {
  const none = { libreta: '', asignatura: '', docente: '' }

  it.each(['fisica', 'primero', '1-ems', 'benitez', 'abenitez', '2026'])(
    'encuentra asignatura, curso, docente y ciclo buscando %s', (search) => {
      expect(filterLibretas([book()], { ...none, search })).toHaveLength(1)
    },
  )

  it('encuentra la orientación sin acentos y combina los filtros específicos', () => {
    const oriented = book({ orientation: 'Ciencias de la Vida' })
    expect(filterLibretas([oriented], { ...none, search: ' CIENCIAS ' })).toHaveLength(1)
    expect(filterLibretas([oriented], { ...none, search: 'ciencias', docente: 'carlos' })).toHaveLength(0)
  })
})

describe('<MisLibretas />', () => {
  const pair = () => [book(), book({ id: 'gb-2', subject: { id: 's2', name: 'Química', code: null } })]
  const many = () => Array.from({ length: 30 }, (_, i) =>
    book({ id: `gb-${i}`, subject: { id: `s-${i}`, name: `Materia ${i}`, code: null } }))

  beforeEach(() => {
    mockedApi.mockReset()
    scope.query = ''
  })

  it('lista las libretas sin repetir asignaturas y con acceso directo', async () => {
    mockedApi.mockResolvedValue({ data: pair() })
    render(<MisLibretas />)
    expect(await screen.findByRole('heading', { name: 'Física' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Química' })).toBeInTheDocument()
    expect(screen.getByText('Mostrando 1–2 de 2 libretas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir libreta de Física · Primero (2026)' })).toHaveAttribute('href', '/libreta/gb-1')
    expect(screen.queryByLabelText('Docente')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Páginas de libretas' })).not.toBeInTheDocument()
  })

  it('busca automáticamente y limpiar devuelve el estado inicial', async () => {
    mockedApi.mockResolvedValue({ data: pair() })
    render(<MisLibretas />)
    await screen.findByRole('heading', { name: 'Física' })
    fireEvent.change(screen.getByLabelText('Buscar libreta'), { target: { value: 'quimica' } })
    expect(screen.queryByRole('heading', { name: 'Física' })).not.toBeInTheDocument()
    expect(screen.getByText('Mostrando 1–1 de 1 libretas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getByRole('heading', { name: 'Física' })).toBeInTheDocument()
    expect(screen.getByLabelText('Buscar libreta')).toHaveValue('')
  })

  it('permite combinar curso y estado con tres botones', async () => {
    mockedApi.mockResolvedValue({ data: [
      book(), book({ id: 'closed', status: 'ARCHIVED', course: { id: 'c2', name: 'Segundo', code: '2-EMS', level: 'EMS' } }),
    ] })
    render(<MisLibretas />)
    await screen.findByText('Mostrando 1–2 de 2 libretas')
    fireEvent.click(screen.getByRole('button', { name: 'Cerradas' }))
    expect(screen.getByRole('button', { name: 'Cerradas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/libreta/closed')
    fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c-1' } })
    expect(screen.getByText('Ninguna libreta coincide con el filtro.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas las libretas' }))
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByLabelText('Curso')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Activas' }))
    expect(screen.getByRole('link')).toHaveAttribute('href', '/libreta/gb-1')
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('despliega filtros específicos y los indica cuando se vuelven a cerrar', async () => {
    mockedApi.mockResolvedValue({ data: pair() })
    render(<MisLibretas />)
    await screen.findByRole('heading', { name: 'Física' })
    const options = screen.getByRole('button', { name: 'Más filtros y opciones' })
    expect(options).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(options)
    fireEvent.change(screen.getByLabelText('Asignatura'), { target: { value: 'quimica' } })
    fireEvent.change(screen.getByLabelText('Docente'), { target: { value: 'benitez' } })
    expect(screen.getAllByRole('link')).toHaveLength(1)
    fireEvent.click(options)
    expect(options).toHaveTextContent('(2)')
    expect(screen.getByText('Asignatura: quimica · Docente: benitez')).toBeInTheDocument()
    expect(screen.queryByLabelText('Asignatura')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(options).not.toHaveTextContent('(2)')
  })

  it('explica de dónde salen las libretas cuando el docente no tiene ninguna', async () => {
    mockedApi.mockResolvedValue({ data: [] })
    render(<MisLibretas />)
    expect(await screen.findByText(/No tenés libretas en este ciclo/)).toBeInTheDocument()
  })

  it('distingue no tener libretas de una búsqueda sin coincidencias', async () => {
    mockedApi.mockResolvedValue({ data: [book()] })
    render(<MisLibretas />)
    await screen.findByRole('heading', { name: 'Física' })
    fireEvent.change(screen.getByLabelText('Buscar libreta'), { target: { value: 'zzz' } })
    expect(screen.getByText('Ninguna libreta coincide con el filtro.')).toBeInTheDocument()
    expect(screen.queryByText(/No tenés libretas en este ciclo/)).not.toBeInTheDocument()
  })

  it('marca las libretas cerradas como sólo lectura y permite abrirlas', async () => {
    mockedApi.mockResolvedValue({ data: [book({ status: 'ARCHIVED' })] })
    render(<MisLibretas />)
    expect(await screen.findByText('Ciclo cerrado · sólo lectura')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/libreta/gb-1')
  })

  it('mantiene las orientaciones visibles para distinguir libretas del mismo curso', async () => {
    mockedApi.mockResolvedValue({ data: [book({ orientation: 'Ciencias de la Vida' }), book({ id: 'other', orientation: 'Social y Humanístico', teacher: null })] })
    render(<MisLibretas />)
    expect(await screen.findByText('Ciencias de la Vida')).toBeInTheDocument()
    expect(screen.getByText('Social y Humanístico')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Social y Humanístico/ })).toHaveAttribute('href', '/libreta/other')
    expect(screen.getByText('Sin titular asignado')).toBeInTheDocument()
  })

  it('muestra un error con reintento sin confundirlo con un ciclo sin libretas', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Sesión vencida')).mockResolvedValueOnce({ data: [book()] })
    render(<MisLibretas />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sesión vencida')
    expect(screen.queryByText(/No tenés libretas en este ciclo/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Física' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('pagina de a doce y vuelve a la primera página al filtrar', async () => {
    mockedApi.mockResolvedValue({ data: many() })
    render(<MisLibretas />)
    await screen.findByText('Mostrando 1–12 de 30 libretas')
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    expect(screen.getByRole('heading', { name: 'Materia 12' })).toBeInTheDocument()
    expect(screen.getByText('Mostrando 13–24 de 30 libretas')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    expect(screen.getByRole('heading', { name: 'Materia 25' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }))
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar libreta'), { target: { value: 'Materia 0' } })
    expect(screen.getByRole('heading', { name: 'Materia 0' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('cambiar el tamaño de página reinicia la paginación', async () => {
    mockedApi.mockResolvedValue({ data: many() })
    render(<MisLibretas />)
    await screen.findByText('Página 1 de 3')
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Más filtros y opciones' }))
    fireEvent.change(screen.getByLabelText('Libretas por página'), { target: { value: '24' } })
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(24)
  })

  it('consulta el ciclo seleccionado y restablece el curso al cambiar de ciclo', async () => {
    scope.query = 'schoolYearId=sy-1'
    mockedApi.mockResolvedValue({ data: [book()] })
    const view = render(<MisLibretas />)
    await screen.findByRole('heading', { name: 'Física' })
    expect(mockedApi).toHaveBeenLastCalledWith('/gradebook/mine?schoolYearId=sy-1')
    fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'c-1' } })
    scope.query = 'schoolYearId=sy-2'
    mockedApi.mockResolvedValue({ data: [book({ id: 'new', course: { id: 'c2', name: 'Segundo', code: null, level: 'EMS' } })] })
    view.rerender(<MisLibretas />)
    await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/libreta/new'))
    expect(mockedApi).toHaveBeenLastCalledWith('/gradebook/mine?schoolYearId=sy-2')
    expect(screen.getByLabelText('Curso')).toHaveValue('')
  })

  it('ignora una respuesta tardía del ciclo anterior', async () => {
    let resolveOld!: (value: { data: GradeBookHeader[] }) => void
    mockedApi.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
    const view = render(<MisLibretas />)
    scope.query = 'schoolYearId=new'
    mockedApi.mockResolvedValue({ data: [book({ id: 'new' })] })
    view.rerender(<MisLibretas />)
    await screen.findByRole('heading', { name: 'Física' })
    await act(async () => { resolveOld({ data: [book({ id: 'old' })] }) })
    expect(screen.getByRole('link')).toHaveAttribute('href', '/libreta/new')
  })
})
