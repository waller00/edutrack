import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { compressImage, fileToDataUrl } from './image-upload'

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

  it('falls back to the original file when blob generation fails', async () => {
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

    const result = await compressImage(sourceFile, 0.7, 800)

    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 500, 300)
    expect(result).toBe(sourceFile)
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
