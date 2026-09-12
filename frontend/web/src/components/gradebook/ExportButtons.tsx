'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { apiBaseUrl } from '@/lib/api/client'

/**
 * Descargas de la libreta (RF-120).
 *
 * Va por `fetch` + blob y no por un `<a href>` directo porque la API vive en otro origen y la
 * sesión viaja en una cookie: un enlace plano no la mandaría y la descarga daría 401.
 */
export default function ExportButtons({ gradeBookId }: { gradeBookId: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(kind: 'xlsx' | 'pdf') {
    setBusy(kind)
    setError(null)
    try {
      const res = await fetch(`${apiBaseUrl()}/gradebook/${gradeBookId}/exports/${kind}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`No se pudo generar la exportación (${res.status})`)

      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = match?.[1] ?? `libreta.${kind}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar')
    } finally {
      setBusy(null)
    }
  }

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
