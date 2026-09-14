'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { apiBlob } from '@/lib/api/binary'

const KIND_LABELS: Record<string, string> = {
  CURRICULAR: 'Adecuación curricular',
  EVALUATION: 'Adecuación de evaluación',
  ACCESSIBILITY: 'Accesibilidad',
  OTHER: 'Otra adecuación',
}

const APE_LABELS: Record<string, string> = {
  PASSED: 'salvó',
  FAILED: 'no salvó',
  NOT_TAKEN: 'no se presentó',
}

type Sheet = {
  student: {
    id: string
    firstName: string
    lastName: string
    documentId: string | null
    birthDate: string | null
    photo: { mimeType: string; byteSize: number; updatedAt: string } | null
  }
  admission: { kind: string; label: string }
  apeReferred: boolean
  pendingSubjects: {
    id: string
    subjectName: string
    schoolYearCode: number | null
    origin: string
    apeDecember: string | null
    apeFebruary: string | null
  }[]
  accommodations: { id: string; kind: string; summary: string; externalUrl: string | null }[]
}

/** dd/mm/aaaa a partir de un ISO, sin depender del locale del navegador. */
function formatDay(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function apeText(row: Sheet['pendingSubjects'][number]): string | null {
  const parts: string[] = []
  if (row.apeDecember) parts.push(`APE diciembre: ${APE_LABELS[row.apeDecember] ?? row.apeDecember}`)
  if (row.apeFebruary) parts.push(`APE febrero: ${APE_LABELS[row.apeFebruary] ?? row.apeFebruary}`)
  return parts.length ? parts.join(' · ') : null
}

/**
 * Hoja del estudiante dentro de la libreta.
 *
 * Junta lo que administración cargó con lo que el docente necesita al poner la nota: las
 * adecuaciones y las materias que arrastra se tienen en cuenta para calificar, así que van acá y no
 * en una pantalla aparte a la que habría que salir.
 */
export default function StudentSheet({
  gradeBookId,
  studentId,
  onClose,
}: {
  gradeBookId: string
  studentId: string
  onClose: () => void
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSheet(await api<Sheet>(`/gradebook/${gradeBookId}/students/${studentId}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la hoja del estudiante')
    }
  }, [gradeBookId, studentId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const meta = sheet?.student.photo
    if (!meta) return
    let revoked = false
    let url: string | null = null
    apiBlob(`/gradebook/${gradeBookId}/students/${studentId}/photo?v=${Date.parse(meta.updatedAt)}`)
      .then((blob) => {
        if (!blob || revoked) return
        url = URL.createObjectURL(blob)
        setPhoto(url)
      })
      .catch(() => {
        /* sin foto se muestran las iniciales; no es motivo para romper la hoja */
      })
    return () => {
      revoked = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [sheet, gradeBookId, studentId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const initials = sheet
    ? `${sheet.student.lastName[0] ?? ''}${sheet.student.firstName[0] ?? ''}`.toUpperCase()
    : ''

  return (
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="student-sheet-title">
      <div className="responsive-modal-panel max-w-2xl space-y-4">
        <header className="flex items-start justify-between gap-3">
          <h2 id="student-sheet-title" className="text-lg font-semibold text-gray-900">
            {sheet ? `${sheet.student.lastName}, ${sheet.student.firstName}` : 'Hoja del estudiante'}
          </h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {!sheet && !error && (
          <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Abriendo la hoja…
          </p>
        )}

        {sheet && (
          <>
            <div className="flex gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-slate-50">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- blob local, no una URL remota
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xl font-semibold text-slate-400" aria-hidden>
                    {initials}
                  </span>
                )}
              </div>

              <dl className="grid flex-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-gray-500">Cédula</dt>
                  <dd className="font-mono text-gray-900">{sheet.student.documentId ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-gray-500">Nacimiento</dt>
                  <dd className="text-gray-900">{formatDay(sheet.student.birthDate)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-gray-500">Ingreso</dt>
                  <dd className="text-gray-900">{sheet.admission.label}</dd>
                </div>
              </dl>
            </div>

            {sheet.apeReferred && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Derivado a APE.
              </p>
            )}

            <section>
              <h3 className="text-sm font-semibold text-gray-900">Materias que arrastra</h3>
              {sheet.pendingSubjects.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">No debe ninguna materia.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {sheet.pendingSubjects.map((row) => (
                    <li key={row.id} className="text-sm text-gray-800">
                      {row.subjectName}
                      {row.schoolYearCode ? <span className="text-gray-500"> ({row.schoolYearCode})</span> : null}
                      {apeText(row) && <span className="block text-xs text-gray-500">{apeText(row)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                Adecuaciones
                {sheet.accommodations.length > 0 && (
                  <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
                )}
              </h3>
              {sheet.accommodations.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">Sin adecuaciones vigentes.</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {sheet.accommodations.map((row) => (
                    <li key={row.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                      <p className="text-xs font-medium text-amber-900">
                        {KIND_LABELS[row.kind] ?? row.kind}
                      </p>
                      <p className="text-sm text-gray-800">{row.summary}</p>
                      {row.externalUrl && (
                        <a
                          href={row.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                        >
                          Ver el informe completo
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
