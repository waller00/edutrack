import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TestPreprocessingPage from './page'
import { api } from '@/lib/api'
import { compressImage, fileToDataUrl } from '@/lib/image-upload'

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
vi.mock('@/lib/image-upload', () => ({
  compressImage: vi.fn(),
  fileToDataUrl: vi.fn(),
}))

const mockedApi = vi.mocked(api)
const mockedCompress = vi.mocked(compressImage)
const mockedDataUrl = vi.mocked(fileToDataUrl)

function pngFile(name = 'dni.png', size = 1000) {
  const f = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('TestPreprocessingPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedCompress.mockReset()
    mockedDataUrl.mockReset()
    mockedCompress.mockImplementation(async (file) => file)
    mockedDataUrl.mockResolvedValue('data:image/png;base64,abc')
  })

  it('rechaza archivo no imagen', async () => {
    render(<TestPreprocessingPage />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const bad = new File(['x'], 'a.txt', { type: 'text/plain' })
    Object.defineProperty(bad, 'size', { value: 100 })
    fireEvent.change(input, { target: { files: [bad] } })

    expect(await screen.findByText(/imagen válida/i)).toBeInTheDocument()
  })

  it('flujo exitoso: muestra recomendación y resultados', async () => {
    mockedApi.mockResolvedValueOnce({
      success: true,
      results: [
        {
          strategy: 'strategy_best',
          confidence: 85,
          score: 9,
          processingTime: 10,
          textLength: 0,
          text: '',
        },
      ],
      recommendation: {
        strategy: 'strategy_best',
        confidence: 85,
        score: 9,
        extractedData: { firstName: 'Juan' },
      },
    })

    render(<TestPreprocessingPage />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pngFile()] } })

    fireEvent.click(screen.getByRole('button', { name: /probar preprocesamiento/i }))

    await waitFor(() => {
      expect(screen.getByText(/Mejor Estrategia/i)).toBeInTheDocument()
      expect(screen.getByText('🏆 MEJOR')).toBeInTheDocument()
      expect(screen.getByText('Juan')).toBeInTheDocument()
    })
    expect(mockedApi).toHaveBeenCalledWith(
      '/auth/test-all-strategies',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('API success false muestra mensaje de error', async () => {
    mockedApi.mockResolvedValueOnce({ success: false, message: 'Falló OCR' })

    render(<TestPreprocessingPage />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pngFile()] } })
    fireEvent.click(screen.getByRole('button', { name: /probar preprocesamiento/i }))

    expect(await screen.findByText('Falló OCR')).toBeInTheDocument()
  })

  it('catch de red muestra mensaje', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Network down'))

    render(<TestPreprocessingPage />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [pngFile()] } })
    fireEvent.click(screen.getByRole('button', { name: /probar preprocesamiento/i }))

    expect(await screen.findByText(/Network down/)).toBeInTheDocument()
  })
})
