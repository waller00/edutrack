const MAX_DNI_IMAGE_BYTES = 5 * 1024 * 1024

export function validateDniTestImageFile(file: File, maxBytes = MAX_DNI_IMAGE_BYTES): string | null {
  if (!file.type.startsWith('image/') || file.size > maxBytes) {
    return 'El archivo debe ser una imagen válida y no exceder 5MB.'
  }
  return null
}

export function getPreprocessingConfidenceColorClass(confidence: number): string {
  if (confidence >= 80) return 'text-green-600 bg-green-50'
  if (confidence >= 60) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

const TYPE_LABELS: Record<string, string> = {
  original: 'Imagen Original',
  preprocessed: 'Preprocesada',
  cropped: 'Recortada',
  full_pipeline: 'Pipeline Completo',
}

export function getPreprocessingStrategyTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

export type PreprocessingTestApiResponse = {
  success: boolean
  results?: unknown[]
  recommendation?: unknown
  message?: string
}

export function applyPreprocessingTestApiResponse(res: PreprocessingTestApiResponse): {
  testResults: unknown[]
  recommendation: unknown | null
  userMessage: string
  isSuccessBanner: boolean
} {
  if (res.success) {
    return {
      testResults: Array.isArray(res.results) ? res.results : [],
      recommendation: res.recommendation ?? null,
      userMessage: '✅ Prueba de preprocesamiento completada exitosamente.',
      isSuccessBanner: true,
    }
  }
  return {
    testResults: [],
    recommendation: null,
    userMessage: res.message || 'Error durante la prueba de preprocesamiento.',
    isSuccessBanner: false,
  }
}
