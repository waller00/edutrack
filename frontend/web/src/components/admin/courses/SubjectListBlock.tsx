'use client'

import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { SubjectStatusChip } from './StatusChips'
import type { SubjectDraft, SubjectRow } from './course-types'
import { emptySubjectDraft } from './course-types'

type Props = {
  title: string
  hint?: string
  subjects: SubjectRow[]
  loading?: boolean
  addLabel: string
  onCreate: (draft: SubjectDraft) => Promise<void>
  onUpdate: (id: string, draft: SubjectDraft) => Promise<void>
  onRemove: (id: string) => Promise<void>
  readOnly?: boolean
  showStatus?: boolean
}

export default function SubjectListBlock({
  title,
  hint,
  subjects,
  loading,
  addLabel,
  onCreate,
  onUpdate,
  onRemove,
  readOnly,
  showStatus = true,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState(emptySubjectDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState(emptySubjectDraft)
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    if (!draft.name.trim()) return
    setBusy(true)
    try {
      await onCreate(draft)
      setDraft(emptySubjectDraft())
      setShowForm(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(id: string) {
    if (!editDraft.name.trim()) return
    setBusy(true)
    try {
      await onUpdate(id, editDraft)
      setEditingId(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando…
        </div>
      ) : subjects.length === 0 ? (
        <p className="text-sm text-gray-500">Sin asignaturas en esta sección.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {subjects.map((s) => (
            <li key={s.id} className="px-3 py-2.5">
              {editingId === s.id && !readOnly ? (
                <SubjectForm
                  draft={editDraft}
                  onChange={setEditDraft}
                  onCancel={() => setEditingId(null)}
                  onSave={() => void handleSave(s.id)}
                  busy={busy}
                  saveLabel="Guardar"
                />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">{s.name}</div>
                    {showStatus ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <SubjectStatusChip active={s.isActive} assignmentActive={s.assignmentIsActive} />
                      </div>
                    ) : null}
                  </div>
                  {!readOnly ? (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
                        title="Editar"
                        onClick={() => {
                          setEditingId(s.id)
                          setEditDraft({
                            name: s.name,
                            code: s.code ?? '',
                            sortOrder: s.sortOrder,
                            description: s.description ?? '',
                            isActive: s.isActive,
                          })
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1.5 text-red-600 hover:bg-red-50"
                        title="Eliminar"
                        onClick={() => void onRemove(s.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly ? (
        <>
          {showForm ? (
            <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/30 p-3">
              <SubjectForm
                draft={draft}
                onChange={setDraft}
                onCancel={() => {
                  setShowForm(false)
                  setDraft(emptySubjectDraft())
                }}
                onSave={() => void handleCreate()}
                busy={busy}
                saveLabel="Guardar asignatura"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {addLabel}
            </button>
          )}
        </>
      ) : null}
    </div>
  )
}

function SubjectForm({
  draft,
  onChange,
  onCancel,
  onSave,
  busy,
  saveLabel,
}: {
  draft: SubjectDraft
  onChange: (d: SubjectDraft) => void
  onCancel: () => void
  onSave: () => void
  busy: boolean
  saveLabel: string
}) {
  return (
    <div className="grid gap-2">
      <label className="block text-xs">
        <span className="text-gray-600">Nombre</span>
        <input
          className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Ej. Matemática"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="inline h-4 w-4 animate-spin" aria-hidden /> : null}
          {saveLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
          Cancelar
        </button>
      </div>
    </div>
  )
}
