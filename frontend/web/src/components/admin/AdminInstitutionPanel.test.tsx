import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminInstitutionPanel, { logoFileProblem } from './AdminInstitutionPanel'
import { api } from '@/lib/api/client'
import { apiBlob, apiUpload } from '@/lib/api/binary'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/lib/api/binary', () => ({ apiBlob: vi.fn(), apiUpload: vi.fn() }))

const mockedApi = vi.mocked(api)
const mockedBlob = vi.mocked(apiBlob)
const mockedUpload = vi.mocked(apiUpload)

const LOGO = { mimeType: 'image/png', byteSize: 2048, updatedAt: '2026-11-01T12:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  mockedBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:logo')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('logoFileProblem', () => {
  it('acepta PNG y JPEG de hasta 1 MB', () => {
    expect(logoFileProblem({ type: 'image/png', size: 1000 })).toBeNull()
    expect(logoFileProblem({ type: 'image/jpeg', size: 1_048_576 })).toBeNull()
  })

  it('rechaza otros formatos y archivos grandes antes de mandarlos', () => {
    expect(logoFileProblem({ type: 'image/webp', size: 10 })).toMatch(/PNG o JPEG/)
    expect(logoFileProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG o JPEG/)
    expect(logoFileProblem({ type: 'image/png', size: 2_000_000 })).toMatch(/1 MB/)
  })
})

describe('<AdminInstitutionPanel />', () => {
  it('muestra el nombre y la vista previa del logo guardados', async () => {
    mockedApi.mockResolvedValue({ name: 'Instituto de Educación Integral', logo: LOGO })
    render(<AdminInstitutionPanel />)

    expect(await screen.findByDisplayValue('Instituto de Educación Integral')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Logo de la institución' })).toHaveAttribute('src', 'blob:logo')
    expect(mockedBlob).toHaveBeenCalledWith(`/admin/institution/logo?v=${Date.parse(LOGO.updatedAt)}`)
    expect(screen.getByText('Cambiar logo')).toBeInTheDocument()
  })

  it('guarda el nombre', async () => {
    mockedApi.mockResolvedValueOnce({ name: null, logo: null })
    mockedApi.mockResolvedValueOnce({ name: 'Liceo 1', logo: null })
    render(<AdminInstitutionPanel />)

    const input = await screen.findByLabelText('Nombre')
    expect(screen.getByRole('button', { name: 'Guardar nombre' })).toBeDisabled()
    fireEvent.change(input, { target: { value: ' Liceo 1 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/institution')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Liceo 1' })
    expect(await screen.findByText('Nombre guardado.')).toBeInTheDocument()
  })

  it('sube el logo tal cual, sin recortarlo', async () => {
    mockedApi.mockResolvedValue({ name: null, logo: null })
    mockedUpload.mockResolvedValue({ name: null, logo: LOGO })
    render(<AdminInstitutionPanel />)

    const file = new File(['png'], 'logo.png', { type: 'image/png' })
    fireEvent.change(await screen.findByLabelText('Subir logo'), { target: { files: [file] } })

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledWith('/admin/institution/logo', file))
    expect(await screen.findByText('Logo guardado.')).toBeInTheDocument()
  })

  it('no manda un formato que el boletín no puede imprimir', async () => {
    mockedApi.mockResolvedValue({ name: null, logo: null })
    render(<AdminInstitutionPanel />)

    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    fireEvent.change(await screen.findByLabelText('Subir logo'), { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('PNG o JPEG')
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('quita el logo', async () => {
    mockedApi.mockResolvedValueOnce({ name: null, logo: LOGO })
    mockedApi.mockResolvedValueOnce({ name: null, logo: null })
    render(<AdminInstitutionPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Quitar logo/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/admin/institution/logo', { method: 'DELETE' }))
    expect(await screen.findByText('Logo quitado.')).toBeInTheDocument()
    expect(screen.getByText('Subir logo')).toBeInTheDocument()
  })

  it('una carga fallida deja reintentar', async () => {
    mockedApi.mockRejectedValueOnce(new Error('caído'))
    mockedApi.mockResolvedValueOnce({ name: 'Liceo 1', logo: null })
    render(<AdminInstitutionPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByDisplayValue('Liceo 1')).toBeInTheDocument()
  })
})
