import {
  getSuggestionCardClass,
  getSuggestionTextClass,
  getTrainingResultStatus,
  partitionTrainingFiles,
  validateTrainingImageFile,
} from '@/lib/train-dni-helpers'

function img(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('validateTrainingImageFile', () => {
  it('válida', () => {
    expect(validateTrainingImageFile(img('a.png', 'image/png', 1000))).toBeNull()
  })

  it('tipo inválido', () => {
    expect(validateTrainingImageFile(img('a.txt', 'text/plain', 100))).toContain('no es una imagen')
  })

  it('muy grande', () => {
    expect(validateTrainingImageFile(img('a.png', 'image/png', 6 * 1024 * 1024))).toContain('5MB')
  })
})

describe('partitionTrainingFiles', () => {
  it('solo válidos', () => {
    const a = img('a.png', 'image/png', 100)
    const b = img('b.png', 'image/png', 200)
    const { accepted, lastError } = partitionTrainingFiles([a, b])
    expect(accepted).toEqual([a, b])
    expect(lastError).toBeNull()
  })

  it('mezcla: acepta válidos y guarda último error', () => {
    const bad = img('x.txt', 'text/plain', 10)
    const good = img('y.png', 'image/png', 10)
    const { accepted, lastError } = partitionTrainingFiles([bad, good])
    expect(accepted).toEqual([good])
    expect(lastError).toContain('x.txt')
  })
})

describe('suggestion classes', () => {
  it('success warning info', () => {
    expect(getSuggestionCardClass('success')).toContain('green')
    expect(getSuggestionCardClass('warning')).toContain('yellow')
    expect(getSuggestionCardClass('info')).toContain('blue')
    expect(getSuggestionTextClass('success')).toContain('green')
    expect(getSuggestionTextClass('warning')).toContain('yellow')
    expect(getSuggestionTextClass('info')).toContain('blue')
  })
})

describe('getTrainingResultStatus', () => {
  it('exitoso con nombre y apellido', () => {
    const s = getTrainingResultStatus({
      imageIndex: 0,
      textLength: 1,
      score: 1,
      ocrText: '',
      extractedData: { firstName: 'A', lastName: 'B' },
    })
    expect(s.label).toContain('Exitoso')
    expect(s.className).toContain('green')
  })

  it('fallido sin datos completos', () => {
    const s = getTrainingResultStatus({
      imageIndex: 0,
      textLength: 0,
      score: 0,
      ocrText: '',
      extractedData: { firstName: 'A' },
    })
    expect(s.label).toContain('Fallido')
    expect(s.className).toContain('red')
  })
})
