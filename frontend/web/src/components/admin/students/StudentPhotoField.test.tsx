import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentPhotoField, { initialsOf } from './StudentPhotoField'
import { apiBlob, apiUpload } from '@/lib/api/binary'
import { cropToSquare } from '@/lib/media/image-upload'

vi.mock('@/lib/api/binary', () => ({ apiBlob: vi.fn(), apiUpload: vi.fn() }))
vi.mock('@/lib/media/image-upload', () => ({ cropToSquare: vi.fn() }))

const mockedBlob = vi.mocked(apiBlob)
const mockedUpload = vi.mocked(apiUpload)
const mockedCrop = vi.mocked(cropToSquare)

const PHOTO = { mimeType: 'image/jpeg', byteSize: 1234, updatedAt: '2026-03-05T09:00:00.000Z' }
const onChange = vi.fn()
const onError = vi.fn()

function setup(over: Record<string, unknown> = {}) {
  return render(
    <StudentPhotoField
      studentId="s1"
      firstName="Ana"
      lastName="Díaz"
      photo={null}
      onChange={onChange}
      onError={onError}
      {...over}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedBlob.mockResolvedValue(null)
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

describe('initialsOf', () => {
  it('toma la inicial del apellido y la del nombre', () => {
    expect(initialsOf('Ana', 'Díaz')).toBe('DA')
    expect(initialsOf('', 'Díaz')).toBe('D')
    expect(initialsOf('', '')).toBe('')
  })
})

describe('<StudentPhotoField />', () => {
  it('sin foto muestra las iniciales', () => {
    setup()
    expect(screen.getByText('DA')).toBeInTheDocument()
  })

  it('al crear explica que la foto va después, en vez de un botón que no funcionaría', () => {
    setup({ studentId: null })
    expect(screen.getByText(/después de guardar/)).toBeInTheDocument()
    expect(screen.queryByText('Subir foto')).not.toBeInTheDocument()
  })

  it('pide la foto con la versión, para no servir una cacheada vieja', async () => {
    setup({ photo: PHOTO })
    await waitFor(() =>
      expect(mockedBlob).toHaveBeenCalledWith(
        `/admin/students/s1/photo?v=${Date.parse(PHOTO.updatedAt)}`,
      ),
    )
  })

  it('recorta a cuadrado y sube', async () => {
    const cropped = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    mockedCrop.mockResolvedValue(cropped)
    mockedUpload.mockResolvedValue({ photo: PHOTO })

    setup()
    const input = document.getElementById('student-photo') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['raw'], 'original.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(mockedUpload).toHaveBeenCalled())
    expect(mockedCrop).toHaveBeenCalledWith(expect.any(File), 512)
    expect(mockedUpload.mock.calls[0][0]).toBe('/admin/students/s1/photo')
    expect(mockedUpload.mock.calls[0][1]).toBe(cropped)
    expect(onChange).toHaveBeenCalledWith(PHOTO)
  })

  it('reporta el error del backend sin romper la ficha', async () => {
    mockedCrop.mockResolvedValue(new File(['x'], 'f.jpg', { type: 'image/jpeg' }))
    mockedUpload.mockRejectedValue(new Error('La foto supera 1 MB.'))

    setup()
    fireEvent.change(document.getElementById('student-photo') as HTMLInputElement, {
      target: { files: [new File(['raw'], 'f.png', { type: 'image/png' })] },
    })

    await waitFor(() => expect(onError).toHaveBeenCalledWith('La foto supera 1 MB.'))
  })

  it('avisa si el archivo no es una imagen legible', async () => {
    mockedCrop.mockRejectedValue(new Error('El archivo no es una imagen que el navegador pueda leer'))

    setup()
    fireEvent.change(document.getElementById('student-photo') as HTMLInputElement, {
      target: { files: [new File(['%PDF'], 'doc.jpg', { type: 'image/jpeg' })] },
    })

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/no es una imagen/)))
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('quita la foto', async () => {
    mockedUpload.mockResolvedValue({})
    setup({ photo: PHOTO })

    fireEvent.click(await screen.findByRole('button', { name: /Quitar/ }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
    expect(mockedUpload.mock.calls[0][2]).toBe('DELETE')
  })

  it('sin foto no ofrece quitarla', () => {
    setup()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
    expect(screen.getByText('Subir foto')).toBeInTheDocument()
  })

  it('si la foto no se puede cargar, la ficha sigue viva con las iniciales', async () => {
    mockedBlob.mockRejectedValue(new Error('403'))
    setup({ photo: PHOTO })
    await waitFor(() => expect(mockedBlob).toHaveBeenCalled())
    expect(screen.getByText('DA')).toBeInTheDocument()
  })
})
