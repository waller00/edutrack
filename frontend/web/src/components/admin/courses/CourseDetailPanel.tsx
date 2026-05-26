'use client'

import { api } from '@/lib/api/client'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import SubjectListBlock from './SubjectListBlock'
import type { CourseOrientationRow, CourseRow, OrientationRow, SubjectDraft, SubjectRow } from './course-types'
import { courseShortLabel, partitionSubjects } from './course-types'

type Props = {
  course: CourseRow
  schoolYearLabel: string
  subjects: SubjectRow[]
  subjectsLoading: boolean
  courseOrientations: CourseOrientationRow[]
  orientationsCatalog: OrientationRow[]
  onReloadSubjects: () => Promise<void>
  onReloadOrientations: () => Promise<void>
  onCourseUpdated: (course: CourseRow) => void
  onMessage: (msg: string) => void
  withSchoolYear: (path: string) => string
}

export default function CourseDetailPanel({
  course,
  subjects,
  subjectsLoading,
  courseOrientations,
  orientationsCatalog,
  onReloadSubjects,
  onReloadOrientations,
  onMessage,
  withSchoolYear,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [courseOpen, setCourseOpen] = useState(true)
  const [commonOpen, setCommonOpen] = useState(true)
  const [orientationsOpen, setOrientationsOpen] = useState(false)
  const [showHistoricalSubjects, setShowHistoricalSubjects] = useState(false)
  const [attachOrientationId, setAttachOrientationId] = useState('')
  const [newOrientationName, setNewOrientationName] = useState('')
  const [editingOrientationId, setEditingOrientationId] = useState<string | null>(null)
  const [editingOrientationName, setEditingOrientationName] = useState('')

  const currentSubjects = useMemo(
    () =>
      showHistoricalSubjects
        ? subjects
        : subjects.filter(
            (s) =>
              s.isActive &&
              (s.assignmentIsActive ?? true) &&
              (s.assignmentIsOffered ?? true) &&
              (s.visibleInFilters ?? true),
          ),
    [subjects, showHistoricalSubjects],
  )
  const { common, byOrientation } = useMemo(() => partitionSubjects(currentSubjects), [currentSubjects])

  const unattachedOrientations = orientationsCatalog.filter(
    (o) => !courseOrientations.some((co) => co.orientationId === o.id),
  )
  const adminPath = (path: string) => {
    const separator = path.includes('?') ? '&' : '?'
    return withSchoolYear(`${path}${separator}all=1&includeNotOffered=1`)
  }

  async function createSubject(draft: SubjectDraft, opts: { common: boolean; orientationId?: string }) {
    await api(adminPath(`/courses/${course.id}/subjects`), {
      method: 'POST',
      body: JSON.stringify({
        name: draft.name.trim(),
        sortOrder: Number(draft.sortOrder) || 0,
        isActive: true,
        associationType: opts.common ? (course.level === 'EMS' ? 'TRONCO_COMUN_CURSO' : 'CURSO_COMPLETO') : 'ORIENTACION',
        orientationId: opts.orientationId,
      }),
    })
    await onReloadSubjects()
    onMessage(opts.common ? 'Asignatura común agregada.' : 'Asignatura específica agregada.')
  }

  async function updateSubject(id: string, draft: SubjectDraft) {
    await api(adminPath(`/courses/${course.id}/subjects/${id}`), {
      method: 'PUT',
      body: JSON.stringify({
        name: draft.name.trim(),
        code: draft.code.trim() || null,
        description: draft.description.trim() || null,
        sortOrder: Number(draft.sortOrder) || 0,
        isActive: draft.isActive,
      }),
    })
    await onReloadSubjects()
    onMessage('Asignatura actualizada.')
  }

  async function removeSubject(id: string) {
    if (!confirm('¿Eliminar esta asignatura del plan?')) return
    await api(adminPath(`/courses/${course.id}/subjects/${id}`), { method: 'DELETE' })
    await onReloadSubjects()
    onMessage('Asignatura quitada del plan.')
  }

  async function attachOrientation() {
    if (!attachOrientationId) return
    await api(adminPath(`/courses/${course.id}/orientations`), {
      method: 'POST',
      body: JSON.stringify({ orientationId: attachOrientationId, isActive: true }),
    })
    setAttachOrientationId('')
    await onReloadOrientations()
    onMessage('Orientación agregada al curso.')
  }

  async function createOrientation() {
    if (!newOrientationName.trim()) return
    const created = await api<OrientationRow>('/courses/orientations', {
      method: 'POST',
      body: JSON.stringify({ name: newOrientationName.trim(), isActive: true }),
    })
    await api(adminPath(`/courses/${course.id}/orientations`), {
      method: 'POST',
      body: JSON.stringify({ orientationId: created.id, isActive: true }),
    })
    setNewOrientationName('')
    await onReloadOrientations()
    onMessage('Orientación creada y agregada al curso.')
  }

  async function updateOrientation(row: CourseOrientationRow) {
    if (!editingOrientationName.trim()) return
    await api<OrientationRow>(`/courses/orientations/${row.orientationId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: editingOrientationName.trim() }),
    })
    setEditingOrientationId(null)
    setEditingOrientationName('')
    await onReloadOrientations()
    onMessage('Orientación actualizada.')
  }

  async function toggleOrientationOffer(row: CourseOrientationRow) {
    await api(adminPath(`/courses/${course.id}/orientations`), {
      method: 'POST',
      body: JSON.stringify({ orientationId: row.orientationId, isActive: !row.isActive }),
    })
    await onReloadOrientations()
    await onReloadSubjects()
    onMessage(!row.isActive ? 'Orientación activada en el curso.' : 'Orientación desactivada en el curso.')
  }

  async function removeOrientationFromCourse(row: CourseOrientationRow) {
    if (!confirm(`¿Quitar "${row.orientation.name}" de ${courseShortLabel(course.name)}?`)) return
    await api(adminPath(`/courses/${course.id}/orientations/${row.id}`), { method: 'DELETE' })
    await onReloadOrientations()
    await onReloadSubjects()
    onMessage('Orientación quitada del curso.')
  }

  async function deleteOrientation(row: CourseOrientationRow) {
    if (!confirm(`¿Eliminar "${row.orientation.name}" del catálogo? También se ocultará de los cursos donde esté asociada.`)) return
    await api(`/courses/orientations/${row.orientationId}`, { method: 'DELETE' })
    await onReloadOrientations()
    await onReloadSubjects()
    onMessage('Orientación eliminada del catálogo.')
  }

  return (
    <div className="min-h-[560px] bg-white">
      <header className="border-b border-gray-200 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{courseShortLabel(course.name)}</h2>
            <p className="mt-1 text-sm text-gray-500">Asignaturas del curso</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={showHistoricalSubjects}
              onChange={(e) => setShowHistoricalSubjects(e.target.checked)}
            />
            Ver histórico
          </label>
        </div>
      </header>

      <div className="p-5">
        <section className="rounded-md border border-gray-200 bg-white">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-t-md bg-gray-50 px-3 py-3 text-left hover:bg-gray-100"
            onClick={() => setCourseOpen((value) => !value)}
          >
            <span className="flex min-w-0 items-center gap-2">
              {courseOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
              )}
              <span className="truncate text-base font-semibold text-gray-900">{courseShortLabel(course.name)}</span>
            </span>
            <span className="shrink-0 text-xs text-gray-500">
              {common.length} comunes · {courseOrientations.length} orientaciones
            </span>
          </button>

          {courseOpen ? (
            <div className="space-y-2 border-t border-gray-100 p-3">
              <div className="rounded-md border border-sky-100 bg-sky-50/60">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-sky-50"
                  onClick={() => setCommonOpen((value) => !value)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {commonOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-sky-700" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-sky-700" aria-hidden />
                    )}
                    <span className="truncate text-sm font-semibold text-sky-950">Comunes</span>
                  </span>
                  <span className="shrink-0 text-xs text-sky-800">{common.length} asignaturas</span>
                </button>
                {commonOpen ? (
                  <div className="border-t border-sky-100 bg-white p-3">
                    <SubjectListBlock
                      title="Comunes del curso"
                      hint={`Aplican a ${courseShortLabel(course.name)} y aparecen dentro de todas sus orientaciones.`}
                      subjects={common}
                      loading={subjectsLoading}
                      addLabel="Agregar común"
                      onCreate={(d) => createSubject(d, { common: true })}
                      onUpdate={updateSubject}
                      onRemove={removeSubject}
                      showStatus={showHistoricalSubjects}
                    />
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-gray-200 bg-white">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-gray-50"
                  onClick={() => setOrientationsOpen((value) => !value)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {orientationsOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                    )}
                    <span className="truncate text-sm font-semibold text-gray-900">Orientaciones</span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {courseOrientations.length} orientaciones
                  </span>
                </button>

                {orientationsOpen ? (
                  <div className="space-y-2 border-t border-gray-100 p-3">
                    {courseOrientations.length === 0 ? (
                      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                        Este curso no tiene orientaciones.
                      </div>
                    ) : (
                      courseOrientations.map((row) => {
                        const open = expanded[row.id] ?? false
                        const specific = byOrientation.get(row.orientationId) ?? []
                        const isEditing = editingOrientationId === row.id
                        return (
                          <div key={row.id} className="rounded-md border border-gray-200 bg-white">
                            <div className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-gray-50">
                              <button
                                type="button"
                                className="shrink-0"
                                onClick={() => setExpanded((current) => ({ ...current, [row.id]: !open }))}
                              >
                                {open ? (
                                  <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                                )}
                              </button>
                              {isEditing ? (
                                <input
                                  className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                                  value={editingOrientationName}
                                  onChange={(e) => setEditingOrientationName(e.target.value)}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 truncate text-left font-medium text-gray-900"
                                  onClick={() => setExpanded((current) => ({ ...current, [row.id]: !open }))}
                                >
                                  {row.orientation.name}
                                </button>
                              )}
                              <span className="hidden shrink-0 text-xs text-gray-500 sm:inline">
                                {common.length} comunes · {specific.length} específicas
                              </span>
                              {isEditing ? (
                                <div className="flex shrink-0 gap-1">
                                  <button
                                    type="button"
                                    className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                                    onClick={() => void updateOrientation(row)}
                                  >
                                    Guardar
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                                    onClick={() => {
                                      setEditingOrientationId(null)
                                      setEditingOrientationName('')
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              ) : (
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={row.isActive}
                                    title={row.isActive ? 'Desactivar orientación en este curso' : 'Activar orientación en este curso'}
                                    onClick={() => void toggleOrientationOffer(row)}
                                    className={`relative h-5 w-9 rounded-full transition ${
                                      row.isActive ? 'bg-emerald-600' : 'bg-gray-300'
                                    }`}
                                  >
                                    <span
                                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                                        row.isActive ? 'left-4' : 'left-0.5'
                                      }`}
                                    />
                                    <span className="sr-only">
                                      {row.isActive ? 'Desactivar orientación' : 'Activar orientación'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
                                    title="Editar orientación"
                                    onClick={() => {
                                      setEditingOrientationId(row.id)
                                      setEditingOrientationName(row.orientation.name)
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded p-1.5 text-amber-700 hover:bg-amber-50"
                                    title="Quitar del curso"
                                    onClick={() => void removeOrientationFromCourse(row)}
                                  >
                                    <X className="h-4 w-4" aria-hidden />
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded p-1.5 text-red-600 hover:bg-red-50"
                                    title="Eliminar orientación"
                                    onClick={() => void deleteOrientation(row)}
                                  >
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                  </button>
                                </div>
                              )}
                            </div>

                            {open ? (
                              <div className="space-y-4 border-t border-gray-100 p-4">
                                <div className="rounded-md bg-sky-50 p-3">
                                  <div className="mb-2 text-xs font-semibold uppercase text-sky-900">
                                    Comunes heredadas de {courseShortLabel(course.name)}
                                  </div>
                                  {common.length === 0 ? (
                                    <p className="text-sm text-sky-900/70">Todavía no hay comunes cargadas.</p>
                                  ) : (
                                    <ul className="grid gap-1 text-sm text-gray-800 sm:grid-cols-2">
                                      {common.map((subject) => (
                                        <li key={subject.id}>{subject.name}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>

                                <SubjectListBlock
                                  title="Específicas"
                                  subjects={specific}
                                  loading={subjectsLoading}
                                  addLabel="Agregar específica"
                                  onCreate={(d) => createSubject(d, { common: false, orientationId: row.orientationId })}
                                  onUpdate={updateSubject}
                                  onRemove={removeSubject}
                                  showStatus={showHistoricalSubjects}
                                />
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    )}

                    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3">
                      <div className="flex flex-wrap gap-2">
                        <select
                          className="min-w-[12rem] flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                          value={attachOrientationId}
                          onChange={(e) => setAttachOrientationId(e.target.value)}
                        >
                          <option value="">Agregar orientación existente…</option>
                          {unattachedOrientations.map((orientation) => (
                            <option key={orientation.id} value={orientation.id}>
                              {orientation.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!attachOrientationId}
                          onClick={() => void attachOrientation()}
                          className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Agregar
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input
                          className="min-w-[12rem] flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                          placeholder="Nueva orientación"
                          value={newOrientationName}
                          onChange={(e) => setNewOrientationName(e.target.value)}
                        />
                        <button
                          type="button"
                          disabled={!newOrientationName.trim()}
                          onClick={() => void createOrientation()}
                          className="inline-flex items-center gap-1 rounded bg-white px-3 py-1.5 text-sm text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                          Crear
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
