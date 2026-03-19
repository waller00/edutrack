export type TrainingSuggestion = {
  type: 'success' | 'warning' | 'info'
  message: string
  examples?: string[]
}

export type TrainingResult = {
  imageIndex: number
  textLength: number
  score: number
  extractedData?: {
    firstName?: string
    lastName?: string
    nationalId?: string
    birthdate?: string
  }
  ocrText: string
}

const MAX_TRAINING_IMAGE_BYTES = 5 * 1024 * 1024

export function validateTrainingImageFile(file: File, maxBytes = MAX_TRAINING_IMAGE_BYTES): string | null {
  if (!file.type.startsWith('image/')) {
    return `❌ ${file.name} no es una imagen válida`
  }
  if (file.size > maxBytes) {
    return `❌ ${file.name} es demasiado grande (máximo 5MB)`
  }
  return null
}

export function partitionTrainingFiles(
  files: File[],
  maxBytes = MAX_TRAINING_IMAGE_BYTES,
): { accepted: File[]; lastError: string | null } {
  let lastError: string | null = null
  const accepted: File[] = []
  for (const file of files) {
    const err = validateTrainingImageFile(file, maxBytes)
    if (err) lastError = err
    else accepted.push(file)
  }
  return { accepted, lastError }
}

export function getSuggestionCardClass(type: TrainingSuggestion['type']): string {
  if (type === 'success') return 'bg-green-50 border border-green-200'
  if (type === 'warning') return 'bg-yellow-50 border border-yellow-200'
  return 'bg-blue-50 border border-blue-200'
}

export function getSuggestionTextClass(type: TrainingSuggestion['type']): string {
  if (type === 'success') return 'text-green-700'
  if (type === 'warning') return 'text-yellow-700'
  return 'text-blue-700'
}

export function getTrainingResultStatus(result: TrainingResult): { className: string; label: string } {
  const isSuccessful = !!(result.extractedData?.firstName && result.extractedData?.lastName)
  return {
    className: isSuccessful ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
    label: isSuccessful ? '✅ Exitoso' : '❌ Fallido',
  }
}
