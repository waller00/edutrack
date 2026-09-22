'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import FormField, { fieldInputClass } from '@/components/forms/FormField'
import { ACCOMMODATION_KIND_OPTIONS, type StudentAccommodation } from './student-types'

const KIND_LABELS = Object.fromEntries(ACCOMMODATION_KIND_OPTIONS.map((o) => [o.value, o.label]))

type Draft = {
  kind: string
  summary: string
  externalUrl: string
  validUntil: string
}

function emptyDraft(): Draft {
  return { kind: 'CURRICULAR', summary: '', externalUrl: '', validUntil: '' }
}

function draftFromRow(row: StudentAccommodation): Draft {
  return {
    kind: row.kind,
    summary: row.summary,
    externalUrl: row.externalUrl ?? '',
    validUntil: row.validUntil ? row.validUntil.slice(0, 10) : '',
  }
}

function formatStamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Adecuaciones del estudiante.
 *
 * **El informe no se sube.** Se carga el tipo, un resumen de lo que el docente tiene que tener en
 * cuenta al calificar, y el enlace a donde el documento vive. Guardar acá un diagnóstico o un
 * informe psicológico sería guardar datos de salud de un menor en la base y en los backups, que es
 * justamente lo que la política de privacidad del proyecto no permite.
 */
export default function StudentAccommodationsPanel({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<StudentAccommodation[]>([])
  const [draft, setDraft] = useState(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: StudentAccommodation[] }>(`/admin/students/${studentId}/accommodations`)
      setRows(res.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las adecuaciones')
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load])

  function startEdit(row: StudentAccommodation) {
    setEditingId(row.id)
    setDraft(draftFromRow(row))
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(emptyDraft())
  }

  async function save() {
    if (draft.summary.trim() === '') {
      setError('Escribí qué tener en cuenta al calificar.')
      return
    }
    setSaving(true)
    setError(null)
    const body = {
      kind: draft.kind,
      summary: draft.summary.trim(),
      externalUrl: draft.externalUrl.trim() || null,
      validUntil: draft.validUntil || null,
    }
    try {
      if (editingId) {
        await api(`/admin/students/${studentId}/accommodations/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      } else {
        await api(`/admin/students/${studentId}/accommodations`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
      }
      cancelEdit()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la adecuación')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setSaving(true)
    setError(null)
    try {
      await api(`/admin/students/${studentId}/accommodations/${id}`, { method: 'DELETE' })
      if (editingId === id) cancelEdit()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar la adecuación')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando adecuaciones…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
        El informe no se sube al sistema: se guarda el enlace a donde está. En el resumen va lo que el
        docente necesita para calificar, no el diagnóstico.
      </p>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-5 text-center text-sm text-gray-500">
          Sin adecuaciones cargadas.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-600">{KIND_LABELS[row.kind] ?? row.kind}</p>
                  <p className="text-sm text-gray-900">{row.summary}</p>
                  {row.externalUrl && (
                    <a
                      href={row.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-xs text-emerald-700 hover:underline"
                    >
                      {row.externalUrl}
                    </a>
                  )}
                  {row.validUntil && (
                    <p className="text-[11px] text-gray-500">Vence el {row.validUntil.slice(0, 10)}</p>
                  )}
                  <p className="mt-1 text-[11px] italic text-gray-500">
                    {row.createdByName && formatStamp(row.createdAt)
                      ? `Registrado por: ${row.createdByName} ${formatStamp(row.createdAt)}`
                      : formatStamp(row.createdAt)
                        ? `Registrado: ${formatStamp(row.createdAt)}`
                        : null}
                    {row.updatedByName && formatStamp(row.updatedAt) && row.updatedAt !== row.createdAt ? (
                      <>
                        <br />
                        {`Última modificación: ${row.updatedByName} ${formatStamp(row.updatedAt)}`}
                      </>
                    ) : null}
                    {row.teacherSeenAt && formatStamp(row.teacherSeenAt) ? (
                      <>
                        <br />
                        {`Visto por docente: ${row.teacherSeenByName ? `${row.teacherSeenByName} ` : ''}${formatStamp(row.teacherSeenAt)}`}
                      </>
                    ) : (
                      <>
                        <br />
                        Aún no la abrió un docente desde la libreta.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    disabled={saving}
                    aria-label={`Editar la adecuación ${KIND_LABELS[row.kind] ?? row.kind}`}
                    className="text-sky-700 hover:text-sky-900 disabled:opacity-50"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row.id)}
                    disabled={saving}
                    aria-label={`Quitar la adecuación ${KIND_LABELS[row.kind] ?? row.kind}`}
                    className="text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h3 className="text-sm font-medium text-gray-900">
          {editingId ? 'Editar adecuación' : 'Agregar una adecuación'}
        </h3>

        <FormField label="Tipo" id="acc-kind">
          <select
            id="acc-kind"
            className="select-field w-full"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
          >
            {ACCOMMODATION_KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Qué tener en cuenta al calificar"
          id="acc-summary"
          required
          hint="Lo que el docente necesita saber. No el diagnóstico."
        >
          <textarea
            id="acc-summary"
            rows={2}
            className={fieldInputClass('input-field')}
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
        </FormField>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Enlace al informe" id="acc-url" hint="Drive, expediente. El archivo no se sube.">
            <input
              id="acc-url"
              placeholder="https://…"
              className={fieldInputClass('input-field')}
              value={draft.externalUrl}
              onChange={(e) => setDraft({ ...draft, externalUrl: e.target.value })}
            />
          </FormField>
          <FormField label="Vence el" id="acc-until" hint="Opcional. Vencida deja de mostrársele al docente.">
            <input
              id="acc-until"
              type="date"
              className={fieldInputClass('input-field')}
              value={draft.validUntil}
              onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })}
            />
          </FormField>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {editingId ? (
              'Guardar cambios'
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden />
                Agregar
              </>
            )}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
