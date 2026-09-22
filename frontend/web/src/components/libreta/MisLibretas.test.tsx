import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MisLibretas, { filterLibretas, libretaCode } from './MisLibretas'
import { api } from '@/lib/api/client'
import type { GradeBookHeader } from '@/lib/gradebook/types'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
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

describe('<MisLibretas />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lista las libretas y muestra la cantidad', async () => {
    mockedApi.mockResolvedValue({ data: [book(), book({ id: 'gb-2', subject: { id: 's2', name: 'Química', code: null } })] })

    render(<MisLibretas />)

    expect(await screen.findByText('1-EMS · FÍSICA')).toBeInTheDocument()
    expect(screen.getByText('1-EMS · QUÍMICA')).toBeInTheDocument()
    expect(screen.getByText('Cantidad: 2')).toBeInTheDocument()
  })

  it('BUSCAR aplica el filtro y LIMPIAR lo devuelve al estado inicial', async () => {
    mockedApi.mockResolvedValue({ data: [book(), book({ id: 'gb-2', subject: { id: 's2', name: 'Química', code: null } })] })

    render(<MisLibretas />)
    await screen.findByText('1-EMS · FÍSICA')

    fireEvent.change(screen.getByLabelText('Asignatura'), { target: { value: 'quimica' } })
    fireEvent.click(screen.getByRole('button', { name: 'BUSCAR' }))

    await waitFor(() => expect(screen.queryByText('1-EMS · FÍSICA')).not.toBeInTheDocument())
    expect(screen.getByText('Cantidad: 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'LIMPIAR' }))

    expect(await screen.findByText('1-EMS · FÍSICA')).toBeInTheDocument()
    expect(screen.getByText('Cantidad: 2')).toBeInTheDocument()
  })

  it('explica de dónde salen las libretas cuando el docente no tiene ninguna', async () => {
    mockedApi.mockResolvedValue({ data: [] })

    render(<MisLibretas />)

    expect(await screen.findByText(/No tenés libretas en este ciclo/)).toBeInTheDocument()
  })

  it('distingue "no hay ninguna" de "el filtro no encontró nada"', async () => {
    mockedApi.mockResolvedValue({ data: [book()] })

    render(<MisLibretas />)
    await screen.findByText('1-EMS · FÍSICA')

    fireEvent.change(screen.getByLabelText('Asignatura'), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: 'BUSCAR' }))

    expect(await screen.findByText('Ninguna libreta coincide con el filtro.')).toBeInTheDocument()
  })

  it('marca las libretas de un ciclo cerrado como sólo lectura', async () => {
    mockedApi.mockResolvedValue({ data: [book({ status: 'ARCHIVED' })] })

    render(<MisLibretas />)

    expect(await screen.findByText('Ciclo cerrado · sólo lectura')).toBeInTheDocument()
  })

  it('muestra el error de carga sin dejar la pantalla en blanco', async () => {
    mockedApi.mockRejectedValue(new Error('Sesión vencida'))

    render(<MisLibretas />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sesión vencida')
  })

  it('pagina cuando hay más libretas que el tamaño de página', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      book({ id: `gb-${i}`, subject: { id: `s-${i}`, name: `Materia ${i}`, code: null } }),
    )
    mockedApi.mockResolvedValue({ data: many })

    render(<MisLibretas />)
    await screen.findByText('Cantidad: 30')

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    expect(screen.getByText('1-EMS · MATERIA 0')).toBeInTheDocument()
    expect(screen.queryByText('1-EMS · MATERIA 25')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    expect(await screen.findByText('1-EMS · MATERIA 25')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument()
  })
})
