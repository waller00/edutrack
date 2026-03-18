'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import RoleGuard from '@/components/RoleGuard'

type TrainingSuggestion = {
  type: 'success' | 'warning' | 'info'
  message: string
  examples?: string[]
}

type TrainingResult = {
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

type TrainingResponse = {
  analysis: {
    successfulExtractions: number
    failedExtractions: number
    ocrQuality: {
      averageTextLength: number
    }
  }
  suggestions?: TrainingSuggestion[]
  results: TrainingResult[]
}

function getSuggestionCardClass(type: TrainingSuggestion['type']) {
  if (type === 'success') return 'bg-green-50 border border-green-200'
  if (type === 'warning') return 'bg-yellow-50 border border-yellow-200'
  return 'bg-blue-50 border border-blue-200'
}

function getSuggestionTextClass(type: TrainingSuggestion['type']) {
  if (type === 'success') return 'text-green-700'
  if (type === 'warning') return 'text-yellow-700'
  return 'text-blue-700'
}

function getTrainingResultStatus(result: TrainingResult) {
  const isSuccessful = !!(result.extractedData?.firstName && result.extractedData?.lastName)
  return {
    className: isSuccessful ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800',
    label: isSuccessful ? '✅ Exitoso' : '❌ Fallido',
  }
}

export default function TrainDniPage() {
  const [images, setImages] = useState<File[]>([])
  const [training, setTraining] = useState(false)
  const [results, setResults] = useState<TrainingResponse | null>(null)
  const [error, setError] = useState('')

  function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    
    // Validate files
    const validFiles = files.filter(file => {
      if (!file.type.startsWith('image/')) {
        setError(`❌ ${file.name} no es una imagen válida`)
        return false
      }
      if (file.size > 5 * 1024 * 1024) {
        setError(`❌ ${file.name} es demasiado grande (máximo 5MB)`)
        return false
      }
      return true
    })
    
    setImages(prev => [...prev, ...validFiles])
    setError('')
  }

  function removeImage(index: number) {
    setImages(prev => prev.filter((_, i) => i !== index))
  }

  async function trainModel() {
    if (images.length === 0) {
      setError('❌ Por favor, selecciona al menos una imagen')
      return
    }

    setTraining(true)
    setError('')
    setResults(null)

    try {
      // Convert images to base64
      const base64Images = await Promise.all(
        images.map(file => new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.readAsDataURL(file)
        }))
      )

      console.log(`Training with ${base64Images.length} images...`)

      // Call training endpoint
      const response = await api<TrainingResponse>('/auth/train-patterns', {
        method: 'POST',
        body: JSON.stringify({ images: base64Images })
      })

      console.log('Training results:', response)
      setResults(response)

    } catch (error: any) {
      console.error('Training error:', error)
      setError(`❌ Error durante el entrenamiento: ${error.message}`)
    } finally {
      setTraining(false)
    }
  }

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <main className="mx-auto max-w-6xl p-6 space-y-8">
        {/* Header */}
        <section className="text-center py-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
              <span className="text-emerald-600 text-xl">🤖</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Entrenar Modelo OCR</h1>
              <p className="text-emerald-600 font-medium">Mejorar precisión con múltiples DNIs</p>
            </div>
          </div>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Sube múltiples imágenes de DNIs uruguayos para entrenar y mejorar los patrones de extracción de datos.
          </p>
        </section>

        {/* Upload Section */}
        <section className="card">
          <div className="card-header">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">📁 Subir Imágenes de DNIs</h2>
            
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                  id="image-upload"
                  disabled={training}
                />
                <label
                  htmlFor="image-upload"
                  className={`btn-primary cursor-pointer ${
                    training ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  📷 Seleccionar Imágenes
                </label>
                <span className="text-sm text-gray-500">
                  Máximo 5MB por imagen
                </span>
              </div>

              {images.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Imágenes seleccionadas ({images.length}):
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {images.map((file) => (
                      <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-600 flex-1 truncate">
                          {file.name}
                        </span>
                        <button
                          onClick={() => removeImage(images.findIndex((candidate) => candidate === file))}
                          className="text-red-600 hover:text-red-800 text-sm"
                          disabled={training}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {images.length > 0 && (
                <button
                  onClick={trainModel}
                  disabled={training}
                  className="btn-success w-full disabled:opacity-60"
                >
                  {training ? '⏳ Entrenando...' : `🚀 Entrenar con ${images.length} imágenes`}
                </button>
              )}
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}
          </div>
        </section>

        {/* Results Section */}
        {results && (
          <section className="card">
            <div className="card-header">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">📊 Resultados del Entrenamiento</h2>
              
              <div className="space-y-6">
                {/* Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-emerald-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-emerald-600">
                      {results.analysis.successfulExtractions}
                    </div>
                    <div className="text-sm text-emerald-700">Extracciones Exitosas</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-red-600">
                      {results.analysis.failedExtractions}
                    </div>
                    <div className="text-sm text-red-700">Extracciones Fallidas</div>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {Math.round(results.analysis.ocrQuality.averageTextLength)}
                    </div>
                    <div className="text-sm text-blue-700">Promedio Caracteres OCR</div>
                  </div>
                </div>

                {/* Suggestions */}
                {results.suggestions && results.suggestions.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">💡 Sugerencias</h3>
                    <div className="space-y-2">
                      {results.suggestions.map((suggestion) => (
                        <div
                          key={`${suggestion.type}-${suggestion.message}`}
                          className={`p-3 rounded-lg ${getSuggestionCardClass(suggestion.type)}`}
                        >
                          <p className={`text-sm ${getSuggestionTextClass(suggestion.type)}`}>
                            {suggestion.message}
                          </p>
                          {suggestion.examples && (
                            <div className="mt-2 text-xs text-gray-600">
                              Ejemplos: {suggestion.examples.join(', ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detailed Results */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">📋 Resultados Detallados</h3>
                  <div className="space-y-3">
                    {results.results.map((result) => {
                      const status = getTrainingResultStatus(result)
                      return (
                      <div key={`image-${result.imageIndex}`} className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-medium text-gray-900">
                            Imagen {result.imageIndex}
                          </h4>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.className}`}>
                            {status.label}
                          </span>
                        </div>
                        
                        {result.extractedData && (
                          <div className="text-sm text-gray-600 mb-2">
                            <div><strong>Apellido:</strong> {result.extractedData.lastName}</div>
                            <div><strong>Nombre:</strong> {result.extractedData.firstName}</div>
                            <div><strong>CI:</strong> {result.extractedData.nationalId}</div>
                            <div><strong>Fecha:</strong> {result.extractedData.birthdate}</div>
                          </div>
                        )}
                        
                        <details className="text-xs text-gray-500">
                          <summary className="cursor-pointer hover:text-gray-700">
                            Ver texto OCR ({result.textLength} caracteres)
                          </summary>
                          <pre className="mt-2 p-2 bg-white rounded border text-xs overflow-auto max-h-32">
                            {result.ocrText}
                          </pre>
                        </details>
                      </div>
                    )})}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </RoleGuard>
  )
}





