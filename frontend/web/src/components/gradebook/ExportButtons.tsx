'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { downloadFile } from '@/lib/api/download'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'

/**
 * Descargas de la libreta (RF-120).
 *
 * La descarga va por `downloadFile` (fetch + blob con la cookie de sesión).
 *
 * Sólo se ofrece con `gradebook.export`: sin él (inspección, por ejemplo) el servidor responde
 * 403 y el botón no hacía más que dar error.
 */
export default function ExportButtons({ gradeBookId }: { gradeBookId: string }) {
  const auth = useOptionalAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(kind: 'xlsx' | 'pdf') {
    setBusy(kind)
    setError(null)
    try {
      await downloadFile(`/gradebook/${gradeBookId}/exports/${kind}`, `libreta.${kind}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar')
    } finally {
      setBusy(null)
    }
  }

  if (!hasPermission(auth?.me, 'gradebook.export')) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-sm text-gray-600">
          <Download className="h-4 w-4 text-gray-400" aria-hidden />
          Exportar:
        </span>
        <button
          type="button"
          onClick={() => void download('xlsx')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'xlsx' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          )}
          Excel de calificaciones y cierres
        </button>
        <button
          type="button"
          onClick={() => void download('pdf')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'pdf' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <FileText className="h-4 w-4" aria-hidden />
          )}
          PDF de la libreta
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
    </div>
  )
}
