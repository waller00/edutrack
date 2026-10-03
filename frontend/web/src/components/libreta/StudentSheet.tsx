'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { apiBlob } from '@/lib/api/binary'
import type { StudentBadgeFocus } from './StudentBadges'

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
  accommodations: {
    id: string
    kind: string
    summary: string
    externalUrl: string | null
    createdAt?: string | null
    updatedAt?: string | null
    createdByName?: string | null
    updatedByName?: string | null
    teacherSeenAt?: string | null
  }[]
  generalNotes?: string | null
  generalNotesMeta?: { updatedAt: string | null; updatedByName: string | null } | null
}

/** dd/mm/aaaa a partir de un ISO, sin depender del locale del navegador. */
function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function formatStamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function apeText(row: Sheet['pendingSubjects'][number]): string | null {
  const parts: string[] = []
  if (row.apeDecember) parts.push(`APE diciembre: ${APE_LABELS[row.apeDecember] ?? row.apeDecember}`)
  if (row.apeFebruary) parts.push(`APE febrero: ${APE_LABELS[row.apeFebruary] ?? row.apeFebruary}`)
  return parts.length ? parts.join(' · ') : null
}

function AuditLine({
  registeredBy,
  registeredAt,
  updatedBy,
  updatedAt,
}: {
  registeredBy?: string | null
  registeredAt?: string | null
  updatedBy?: string | null
  updatedAt?: string | null
}) {
  const reg = formatStamp(registeredAt)
  const upd = formatStamp(updatedAt)
  if (!reg && !upd) return null
  return (
    <p className="mt-2 text-[11px] italic text-gray-500">
      {registeredBy && reg ? `Registrado por: ${registeredBy} ${reg}` : reg ? `Registrado: ${reg}` : null}
      {updatedBy && upd && updatedAt !== registeredAt ? (
        <>
          <br />
          {`Última modificación: ${updatedBy} ${upd}`}
        </>
      ) : null}
    </p>
  )
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
  focusSection,
}: {
  gradeBookId: string
  studentId: string
  onClose: () => void
  /** Si viene de un chip (ADEC/Gen), scrollea a esa sección. */
  focusSection?: StudentBadgeFocus | null
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<HTMLElement | null>(null)
  const accommodationsRef = useRef<HTMLElement | null>(null)
  const generalRef = useRef<HTMLElement | null>(null)
  const exemptionsRef = useRef<HTMLElement | null>(null)

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

  useEffect(() => {
    if (!sheet || !focusSection) return
    const map: Record<StudentBadgeFocus, HTMLElement | null> = {
      pending: pendingRef.current,
      accommodations: accommodationsRef.current,
      general: generalRef.current,
      exemptions: exemptionsRef.current,
    }
    const el = map[focusSection]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    el.classList.add('ring-2', 'ring-sky-400', 'ring-offset-2')
    const t = window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-sky-400', 'ring-offset-2')
    }, 1800)
    return () => window.clearTimeout(t)
  }, [sheet, focusSection])

  const initials = sheet
    ? `${sheet.student.lastName[0] ?? ''}${sheet.student.firstName[0] ?? ''}`.toUpperCase()
    : ''

  const focusGen = focusSection === 'general'

  return (
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="student-sheet-title">
      <div className="responsive-modal-panel max-w-2xl space-y-4">
        <header className="flex items-start justify-between gap-3">
          <h2 id="student-sheet-title" className="text-lg font-semibold text-gray-900">
            {sheet
              ? focusGen
                ? 'Observaciones generales'
                : `${sheet.student.lastName}, ${sheet.student.firstName}`
              : 'Hoja del estudiante'}
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

        {sheet && focusGen && (
          <section ref={generalRef} className="rounded-lg border border-gray-200">
            <div className="grid grid-cols-[6.5rem_1fr] border-b border-gray-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-gray-600">
              <div className="border-r border-gray-200 px-3 py-2">Fecha</div>
              <div className="px-3 py-2">Observaciones generales</div>
            </div>
            <div className="grid grid-cols-[6.5rem_1fr] text-sm">
              <div className="border-r border-gray-100 px-3 py-3 font-mono text-xs text-gray-700">
                {formatDay(sheet.generalNotesMeta?.updatedAt ?? null)}
              </div>
              <div className="px-3 py-3">
                {sheet.generalNotes?.trim() ? (
                  <p className="whitespace-pre-wrap text-gray-900">{sheet.generalNotes}</p>
                ) : (
                  <p className="text-gray-500">Sin observaciones cargadas por administración.</p>
                )}
                <AuditLine
                  registeredBy={sheet.generalNotesMeta?.updatedByName}
                  registeredAt={sheet.generalNotesMeta?.updatedAt}
                  updatedBy={sheet.generalNotesMeta?.updatedByName}
                  updatedAt={sheet.generalNotesMeta?.updatedAt}
                />
              </div>
            </div>
          </section>
        )}

        {sheet && !focusGen && (
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

            <section ref={pendingRef} className="rounded-lg">
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

            <section ref={accommodationsRef} className="rounded-lg">
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
                          className="mt-0.5 inline-flex items-center gap-1 break-all text-xs text-emerald-700 hover:underline"
                        >
                          Ver el informe completo
                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                        </a>
                      )}
                      <AuditLine
                        registeredBy={row.createdByName}
                        registeredAt={row.createdAt}
                        updatedBy={row.updatedByName}
                        updatedAt={row.updatedAt}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section ref={generalRef} className="rounded-lg">
              <h3 className="text-sm font-semibold text-gray-900">Observaciones generales</h3>
              {sheet.generalNotes?.trim() ? (
                <>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{sheet.generalNotes}</p>
                  <AuditLine
                    registeredBy={sheet.generalNotesMeta?.updatedByName}
                    registeredAt={sheet.generalNotesMeta?.updatedAt}
                    updatedBy={sheet.generalNotesMeta?.updatedByName}
                    updatedAt={sheet.generalNotesMeta?.updatedAt}
                  />
                </>
              ) : (
                <p className="mt-1 text-sm text-gray-500">Sin observaciones cargadas por administración.</p>
              )}
            </section>
          </>
        )}

        {focusSection === 'exemptions' && (
          <section ref={exemptionsRef} className="rounded-lg">
            <h3 className="text-sm font-semibold text-gray-900">Exenciones</h3>
            <p className="mt-1 text-sm text-gray-500">
              Todavía no hay exenciones administrativas cargadas para este alumno.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
