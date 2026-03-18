'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import RoleGuard from '@/components/RoleGuard'

// Re-use the compressImage function from register/page.tsx
function compressImage(file: File, quality: number, maxWidth: number): Promise<File> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      ctx?.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', quality);
    };
    
    img.src = URL.createObjectURL(file);
  });
}

export default function TestPreprocessingPage() {
  const [dniFile, setDniFile] = useState<File | null>(null);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendation, setRecommendation] = useState<any>(null);

  async function handleTest() {
    setLoading(true);
    setError('');
    setTestResults([]);
    setRecommendation(null);

    if (!dniFile) {
      setError('Por favor, selecciona una imagen de DNI para probar.');
      setLoading(false);
      return;
    }

    try {
      const compressedImage = await compressImage(dniFile, 0.8, 1024);
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(compressedImage);
      });

      const response = await api('/auth/test-all-strategies', {
        method: 'POST',
        body: JSON.stringify({ image: base64 }),
      });

      if (response.success) {
        setTestResults(response.results);
        setRecommendation(response.recommendation);
        setError('✅ Prueba de preprocesamiento completada exitosamente.');
      } else {
        setError(response.message || 'Error durante la prueba de preprocesamiento.');
      }
    } catch (err: any) {
      console.error('Error during preprocessing test:', err);
      setError(err.message || 'Error al probar el preprocesamiento.');
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024) {
        setDniFile(file);
        setError('');
      } else {
        setError('El archivo debe ser una imagen válida y no exceder 5MB.');
      }
    }
  }

  function getConfidenceColor(confidence: number) {
    if (confidence >= 80) return 'text-green-600 bg-green-50';
    if (confidence >= 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  }

  function getTypeLabel(type: string) {
    const labels = {
      original: 'Imagen Original',
      preprocessed: 'Preprocesada',
      cropped: 'Recortada',
      full_pipeline: 'Pipeline Completo'
    };
    return labels[type as keyof typeof labels] || type;
  }

  return (
    <RoleGuard requiredRole="ADMIN">
      <main className="mx-auto max-w-7xl p-6 space-y-8">
        <div className="header-modern">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <span className="text-emerald-600 text-4xl">🧪</span> Prueba de Preprocesamiento OCR
          </h1>
          <p className="text-gray-600">Prueba diferentes configuraciones de preprocesamiento para optimizar la extracción de datos del DNI.</p>
        </div>

        <div className="card shadow-modern-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold text-gray-800">Subir Imagen de DNI</h2>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-emerald-50 file:text-emerald-700
              hover:file:bg-emerald-100"
            disabled={loading}
          />
          {dniFile && (
            <p className="text-sm text-gray-600">
              Archivo seleccionado: {dniFile.name} ({(dniFile.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
          <button
            onClick={handleTest}
            className="btn-primary w-full justify-center"
            disabled={loading || !dniFile}
          >
            {loading ? '⏳ Probando...' : '🧪 Probar Preprocesamiento'}
          </button>
          {error && (
            <div className={`p-3 rounded-lg text-sm ${
              error.includes('✅') ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
            }`}>
              {error}
            </div>
          )}
        </div>

        {recommendation && (
          <div className="card shadow-modern-lg p-6 bg-emerald-50 border border-emerald-200">
            <h2 className="text-xl font-semibold text-emerald-800 mb-4">🎯 Mejor Estrategia</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="font-medium text-emerald-700">Estrategia:</p>
                <p className="text-emerald-600">{recommendation.strategy}</p>
              </div>
              <div>
                <p className="font-medium text-emerald-700">Confianza:</p>
                <span className={`px-2 py-1 rounded text-sm font-medium ${getConfidenceColor(recommendation.confidence)}`}>
                  {recommendation.confidence.toFixed(1)}%
                </span>
              </div>
              <div>
                <p className="font-medium text-emerald-700">Puntuación:</p>
                <span className="px-2 py-1 rounded text-sm font-medium bg-emerald-100 text-emerald-700">
                  {recommendation.score.toFixed(1)}
                </span>
              </div>
            </div>
            {recommendation.extractedData && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <p><strong>Nombre:</strong> {recommendation.extractedData.firstName || 'N/A'}</p>
                <p><strong>Apellido:</strong> {recommendation.extractedData.lastName || 'N/A'}</p>
                <p><strong>Cédula:</strong> {recommendation.extractedData.nationalId || 'N/A'}</p>
                <p><strong>Fecha Nac.:</strong> {recommendation.extractedData.birthdate || 'N/A'}</p>
              </div>
            )}
          </div>
        )}

        {testResults.length > 0 && (
          <div className="card shadow-modern-lg p-6 space-y-6">
            <h2 className="text-xl font-semibold text-gray-800">Resultados de Pruebas</h2>
            
            <div className="space-y-4">
              {testResults.map((result) => (
                <div key={result.strategy} className={`border rounded-lg p-4 space-y-3 ${result.strategy === recommendation?.strategy ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'}`}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-800">{result.strategy}</h3>
                      {result.strategy === recommendation?.strategy && <span className="px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-700">🏆 MEJOR</span>}
                    </div>
                    <div className="flex gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getConfidenceColor(result.confidence)}`}>
                        {result.confidence.toFixed(1)}%
                      </span>
                      <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">
                        Score: {result.score.toFixed(1)}
                      </span>
                      <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">
                        {result.processingTime}ms
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-700">Datos extraídos:</p>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        <p><strong>Nombre:</strong> {result.extractedData?.firstName || 'N/A'}</p>
                        <p><strong>Apellido:</strong> {result.extractedData?.lastName || 'N/A'}</p>
                        <p><strong>Cédula:</strong> {result.extractedData?.nationalId || 'N/A'}</p>
                        <p><strong>Fecha:</strong> {result.extractedData?.birthdate || 'N/A'}</p>
                      </div>
                    </div>
                    
                    <div>
                      <p className="font-medium text-gray-700">Texto OCR ({result.textLength} chars):</p>
                      <pre className="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded mt-1 max-h-32 overflow-y-auto">
                        {result.text || 'Sin texto extraído'}
                      </pre>
                    </div>
                    
                    {result.error && (
                      <div className="p-2 bg-red-50 border border-red-200 rounded text-red-600 text-xs">
                        Error: {result.error}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  );
}
