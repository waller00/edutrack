import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentSheet from './StudentSheet'
import { api } from '@/lib/api/client'
import { apiBlob } from '@/lib/api/binary'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/lib/api/binary', () => ({ apiBlob: vi.fn() }))

const mockedApi = vi.mocked(api)
const mockedBlob = vi.mocked(apiBlob)
const onClose = vi.fn()

const SHEET = {
  student: {
    id: 's1',
    firstName: 'Ana',
    lastName: 'Díaz',
    documentId: '5.123.456-1',
    birthDate: '2010-03-12T12:00:00.000Z',
    photo: null,
  },
  admission: { kind: 'TRANSFER', label: 'Pase de Escuela 42' },
  apeReferred: false,
  pendingSubjects: [],
  accommodations: [],
}

function setup(over: Record<string, unknown> = {}) {
  mockedApi.mockResolvedValue({ ...SHEET, ...over })
  return render(<StudentSheet gradeBookId="gb-1" studentId="s1" onClose={onClose} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedBlob.mockResolvedValue(null)
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

describe('<StudentSheet />', () => {
  it('muestra los datos que cargó administración', async () => {
    setup()

    expect(await screen.findByRole('heading', { name: 'Díaz, Ana' })).toBeInTheDocument()
    expect(screen.getByText('5.123.456-1')).toBeInTheDocument()
    expect(screen.getByText('12/03/2010')).toBeInTheDocument()
    expect(screen.getByText('Pase de Escuela 42')).toBeInTheDocument()
  })

  it('sin foto muestra las iniciales', async () => {
    setup()
    expect(await screen.findByText('DA')).toBeInTheDocument()
  })

  it('avisa si está derivado a APE', async () => {
    setup({ apeReferred: true })
    expect(await screen.findByText('Derivado a APE.')).toBeInTheDocument()
  })

  it('lista las materias que arrastra con el resultado de APE en criollo', async () => {
    setup({
      pendingSubjects: [
        {
          id: 'p-1',
          subjectName: 'Historia',
          schoolYearCode: 2025,
          origin: 'FAILED_THIS_YEAR',
          apeDecember: 'FAILED',
          apeFebruary: null,
        },
      ],
    })

    expect(await screen.findByText(/Historia/)).toBeInTheDocument()
    expect(screen.getByText('APE diciembre: no salvó')).toBeInTheDocument()
  })

  it('dice explícitamente cuando no debe nada, en vez de dejar un hueco', async () => {
    setup()
    expect(await screen.findByText('No debe ninguna materia.')).toBeInTheDocument()
    expect(screen.getByText('Sin adecuaciones vigentes.')).toBeInTheDocument()
  })

  it('muestra la adecuación con su tipo y el enlace al informe', async () => {
    // El informe vive afuera: acá va el resumen de qué tener en cuenta y un enlace.
    setup({
      accommodations: [
        {
          id: 'ad-1',
          kind: 'EVALUATION',
          summary: 'Más tiempo en las pruebas escritas.',
          externalUrl: 'https://drive.example/informe',
        },
      ],
    })

    expect(await screen.findByText('Adecuación de evaluación')).toBeInTheDocument()
    expect(screen.getByText('Más tiempo en las pruebas escritas.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver el informe completo/ })).toHaveAttribute(
      'href',
      'https://drive.example/informe',
    )
  })

  it('una adecuación sin enlace no ofrece un link roto', async () => {
    setup({
      accommodations: [{ id: 'ad-2', kind: 'ACCESSIBILITY', summary: 'Se sienta adelante.', externalUrl: null }],
    })

    expect(await screen.findByText('Se sienta adelante.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ver el informe/ })).not.toBeInTheDocument()
  })

  it('pide la foto por la ruta de la libreta, no por la de administración', async () => {
    // La de administración exige `students.manage`, que el docente no tiene.
    setup({ student: { ...SHEET.student, photo: { mimeType: 'image/jpeg', byteSize: 100, updatedAt: '2026-03-01T12:00:00.000Z' } } })

    await waitFor(() => expect(mockedBlob).toHaveBeenCalled())
    expect(String(mockedBlob.mock.calls[0][0])).toContain('/gradebook/gb-1/students/s1/photo')
  })

  it('muestra el error sin dejar la hoja en blanco', async () => {
    mockedApi.mockRejectedValue(new Error('Ese estudiante no pertenece al grupo de esta libreta.'))

    render(<StudentSheet gradeBookId="gb-1" studentId="s1" onClose={onClose} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('no pertenece al grupo')
  })

  it('Escape cierra la hoja', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Díaz, Ana' })

    const { fireEvent } = await import('@testing-library/react')
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
