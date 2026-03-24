import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TrainDniPage from './page'
import { api } from '@/lib/api'

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))

const mockedApi = vi.mocked(api)

function png(name: string, size = 1000) {
  const f = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('TrainDniPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('muestra botón de entrenar al subir imagen válida', async () => {
    render(<TrainDniPage />)

    const input = document.getElementById('image-upload') as HTMLInputElement
    fireEvent.change(input, { target: { files: [png('solo.png')] } })

    expect(await screen.findByRole('button', { name: /entrenar con 1 imágenes/i })).toBeInTheDocument()
    expect(screen.getByText('solo.png')).toBeInTheDocument()
  })

  it('rechaza txt y muestra error', async () => {
    render(<TrainDniPage />)

    const input = document.getElementById('image-upload') as HTMLInputElement
    const bad = new File(['x'], 'x.txt', { type: 'text/plain' })
    Object.defineProperty(bad, 'size', { value: 10 })
    fireEvent.change(input, { target: { files: [bad] } })

    expect(await screen.findByText(/no es una imagen válida/i)).toBeInTheDocument()
  })

  it('entrenamiento exitoso muestra resumen y sugerencias', async () => {
    mockedApi.mockResolvedValueOnce({
      analysis: {
        successfulExtractions: 2,
        failedExtractions: 0,
        ocrQuality: { averageTextLength: 120.7 },
      },
      suggestions: [{ type: 'info' as const, message: 'Tip 1', examples: ['a', 'b'] }],
      results: [
        {
          imageIndex: 0,
          textLength: 50,
          score: 8,
          ocrText: 'ocr',
          extractedData: { firstName: 'A', lastName: 'B' },
        },
      ],
    })

    render(<TrainDniPage />)

    const input = document.getElementById('image-upload') as HTMLInputElement
    fireEvent.change(input, { target: { files: [png('a.png')] } })

    fireEvent.click(screen.getByRole('button', { name: /entrenar con 1 imágenes/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Resultados del Entrenamiento/i })).toBeInTheDocument()
      expect(screen.getByText(/Extracciones Exitosas/)).toBeInTheDocument()
    })
    expect(screen.getByText('Tip 1')).toBeInTheDocument()
    expect(screen.getByText(/Ejemplos: a, b/)).toBeInTheDocument()
    expect(screen.getByText(/Exitoso/)).toBeInTheDocument()
  })

  it('error API al entrenar', async () => {
    mockedApi.mockRejectedValueOnce(new Error('servidor caído'))

    render(<TrainDniPage />)

    const input = document.getElementById('image-upload') as HTMLInputElement
    fireEvent.change(input, { target: { files: [png('b.png')] } })
    fireEvent.click(screen.getByRole('button', { name: /entrenar con 1 imágenes/i }))

    expect(await screen.findByText(/servidor caído/)).toBeInTheDocument()
  })

  it('elimina imagen de la lista', async () => {
    render(<TrainDniPage />)

    const input = document.getElementById('image-upload') as HTMLInputElement
    fireEvent.change(input, { target: { files: [png('one.png'), png('two.png')] } })

    expect(screen.getByText('one.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /quitar one\.png/i }))

    await waitFor(() => {
      expect(screen.queryByText('one.png')).not.toBeInTheDocument()
    })
  })
})
