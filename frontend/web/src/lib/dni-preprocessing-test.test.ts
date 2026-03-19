import {
  applyPreprocessingTestApiResponse,
  getPreprocessingConfidenceColorClass,
  getPreprocessingStrategyTypeLabel,
  validateDniTestImageFile,
} from '@/lib/dni-preprocessing-test'

describe('validateDniTestImageFile', () => {
  it('acepta imagen dentro del límite', () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(f, 'size', { value: 1024 })
    expect(validateDniTestImageFile(f)).toBeNull()
  })

  it('rechaza no imagen', () => {
    const f = new File(['x'], 'a.txt', { type: 'text/plain' })
    Object.defineProperty(f, 'size', { value: 100 })
    expect(validateDniTestImageFile(f)).toContain('imagen')
  })

  it('rechaza tamaño excesivo', () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(f, 'size', { value: 6 * 1024 * 1024 })
    expect(validateDniTestImageFile(f)).toContain('5MB')
  })

  it('respeta maxBytes custom', () => {
    const f = new File(['x'], 'a.png', { type: 'image/png' })
    Object.defineProperty(f, 'size', { value: 200 })
    expect(validateDniTestImageFile(f, 100)).not.toBeNull()
  })
})

describe('getPreprocessingConfidenceColorClass', () => {
  it('umbrales', () => {
    expect(getPreprocessingConfidenceColorClass(90)).toContain('green')
    expect(getPreprocessingConfidenceColorClass(70)).toContain('yellow')
    expect(getPreprocessingConfidenceColorClass(50)).toContain('red')
  })
})

describe('getPreprocessingStrategyTypeLabel', () => {
  it('mapea tipos conocidos', () => {
    expect(getPreprocessingStrategyTypeLabel('original')).toBe('Imagen Original')
    expect(getPreprocessingStrategyTypeLabel('full_pipeline')).toBe('Pipeline Completo')
  })

  it('devuelve el tipo si no está mapeado', () => {
    expect(getPreprocessingStrategyTypeLabel('custom')).toBe('custom')
  })
})

describe('applyPreprocessingTestApiResponse', () => {
  it('éxito con resultados', () => {
    const r = applyPreprocessingTestApiResponse({
      success: true,
      results: [{ strategy: 'a' }],
      recommendation: { confidence: 90 },
    })
    expect(r.isSuccessBanner).toBe(true)
    expect(r.testResults).toHaveLength(1)
    expect(r.recommendation).toEqual({ confidence: 90 })
    expect(r.userMessage).toContain('exitosamente')
  })

  it('éxito sin results usa array vacío', () => {
    const r = applyPreprocessingTestApiResponse({ success: true })
    expect(r.testResults).toEqual([])
  })

  it('fallo con mensaje del backend', () => {
    const r = applyPreprocessingTestApiResponse({ success: false, message: 'OCR falló' })
    expect(r.isSuccessBanner).toBe(false)
    expect(r.userMessage).toBe('OCR falló')
    expect(r.testResults).toEqual([])
  })

  it('fallo sin mensaje usa default', () => {
    const r = applyPreprocessingTestApiResponse({ success: false })
    expect(r.userMessage).toContain('preprocesamiento')
  })
})
