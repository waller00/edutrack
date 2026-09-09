import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { compressImage, cropToSquare, fileToDataUrl } from './image-upload'

describe('image-upload', () => {
  const originalCreateElement = document.createElement.bind(document)
  const originalImage = globalThis.Image
  const originalCreateObjectURL = URL.createObjectURL
  const originalFileReader = globalThis.FileReader
  const drawImage = vi.fn()
  const toBlob = vi.fn()

  beforeEach(() => {
    drawImage.mockReset()
    toBlob.mockReset()

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toBlob,
        } as unknown as HTMLCanvasElement
      }

      return originalCreateElement(tagName)
    }) as typeof document.createElement)

    URL.createObjectURL = vi.fn(() => 'blob:mock')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.Image = originalImage
    URL.createObjectURL = originalCreateObjectURL
    globalThis.FileReader = originalFileReader
  })

  it('compresses oversized images into jpeg files', async () => {
    const sourceFile = new File(['raw'], 'avatar.png', { type: 'image/png' })

    class MockImage {
      width = 1600
      height = 800
      onload: null | (() => void) = null

      set src(_value: string) {
        this.onload?.()
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image
    toBlob.mockImplementation((callback: BlobCallback) => callback?.(new Blob(['compressed'], { type: 'image/jpeg' })))

    const result = await compressImage(sourceFile, 0.7, 800)

    expect(URL.createObjectURL).toHaveBeenCalledWith(sourceFile)
    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 800, 400)
    expect(result).toBeInstanceOf(File)
    expect(result.name).toBe('avatar.png')
    expect(result.type).toBe('image/jpeg')
  })

  it('falla con un mensaje si no se puede generar el blob', async () => {
    // Antes devolvía el archivo original sin comprimir; eso subía al servidor algo que nadie
    // validó ni redimensionó. Es mejor cortar acá y decirlo.
    const sourceFile = new File(['raw'], 'avatar.png', { type: 'image/png' })

    class MockImage {
      width = 500
      height = 300
      onload: null | (() => void) = null

      set src(_value: string) {
        this.onload?.()
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image
    toBlob.mockImplementation((callback: BlobCallback) => callback?.(null))

    await expect(compressImage(sourceFile, 0.7, 800)).rejects.toThrow(/No se pudo procesar/)
    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 500, 300)
  })

  it('rechaza si el archivo no es una imagen, en vez de colgarse para siempre', async () => {
    // Era el bug: sin `onerror`, un PDF renombrado .jpg dejaba la promesa pendiente y el botón
    // congelado en "Guardando…".
    const notAnImage = new File(['%PDF-1.4'], 'documento.jpg', { type: 'image/jpeg' })

    class MockImage {
      width = 0
      height = 0
      onload: null | (() => void) = null
      onerror: null | (() => void) = null

      set src(_value: string) {
        this.onerror?.()
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image

    await expect(compressImage(notAnImage, 0.7, 800)).rejects.toThrow(/no es una imagen/)
  })

  it('cropToSquare recorta el cuadrado central de una imagen apaisada', async () => {
    const sourceFile = new File(['raw'], 'avatar.png', { type: 'image/png' })

    class MockImage {
      width = 1000
      height = 400
      onload: null | (() => void) = null

      set src(_value: string) {
        this.onload?.()
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image
    toBlob.mockImplementation((callback: BlobCallback) => callback?.(new Blob(['x'], { type: 'image/jpeg' })))

    const result = await cropToSquare(sourceFile, 320)

    // Lado 400 (el menor), desplazado 300 en x para quedar centrado, escalado a 320.
    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 300, 0, 400, 400, 0, 0, 320, 320)
    expect(result.type).toBe('image/jpeg')
  })

  it('cropToSquare no desplaza una imagen ya cuadrada', async () => {
    class MockImage {
      width = 600
      height = 600
      onload: null | (() => void) = null

      set src(_value: string) {
        this.onload?.()
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image
    toBlob.mockImplementation((callback: BlobCallback) => callback?.(new Blob(['x'], { type: 'image/jpeg' })))

    await cropToSquare(new File(['raw'], 'a.png', { type: 'image/png' }), 320)

    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 600, 600, 0, 0, 320, 320)
  })

  it('converts files into data urls', async () => {
    class MockFileReader {
      result = 'data:image/png;base64,abc123'
      onload: null | (() => void) = null

      readAsDataURL(_file: Blob) {
        this.onload?.()
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader

    const result = await fileToDataUrl(new File(['raw'], 'avatar.png', { type: 'image/png' }))

    expect(result).toBe('data:image/png;base64,abc123')
  })
})
