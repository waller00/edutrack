'use client'

import { api } from '@/lib/api/client'
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import SubjectListBlock from './SubjectListBlock'
import {
  CatalogStatusChip,
  FilterVisibilityChip,
  OfferingStatusChip,
  SubjectStatusChip,
} from './StatusChips'
import type {
  CourseDetailTab,
  CourseOrientationRow,
  CourseRow,
  OrientationRow,
  SubjectDraft,
  SubjectRow,
} from './course-types'
import {
  courseShortLabel,
  emptySubjectDraft,
  isOfferedInCycle,
  isVisibleInFilters,
  partitionSubjects,
} from './course-types'

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

function emptyOrientationDraft() {
  return { name: '', code: '', description: '', sortOrder: 0, isActive: true as boolean }
}

export default function CourseDetailPanel({
  course,
  schoolYearLabel,
  subjects,
  subjectsLoading,
  courseOrientations,
  orientationsCatalog,
  onReloadSubjects,
  onReloadOrientations,
  onCourseUpdated,
  onMessage,
  withSchoolYear,
}: Props) {
  const [tab, setTab] = useState<CourseDetailTab>('common')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [orientationDraft, setOrientationDraft] = useState(emptyOrientationDraft)
  const [attachOrientationId, setAttachOrientationId] = useState('')
  const [courseEdit, setCourseEdit] = useState({
    name: course.name,
    code: course.code ?? '',
    level: (course.level ?? 'EBI') as 'EBI' | 'EMS',
    sortOrder: course.sortOrder ?? 0,
    description: course.description ?? '',
    isActive: course.isActive,
    offeringIsActive: course.offeringIsActive ?? course.isActive,
    offeringNotes: course.offeringNotes ?? '',
  })
  const [savingCourse, setSavingCourse] = useState(false)

  useEffect(() => {
    setCourseEdit({
      name: course.name,
      code: course.code ?? '',
      level: (course.level ?? 'EBI') as 'EBI' | 'EMS',
      sortOrder: course.sortOrder ?? 0,
      description: course.description ?? '',
      isActive: course.isActive,
      offeringIsActive: course.offeringIsActive ?? course.isActive,
      offeringNotes: course.offeringNotes ?? '',
    })
  }, [course])

  const { common, byOrientation } = useMemo(() => partitionSubjects(subjects), [subjects])
  const hasOrientations = courseOrientations.length > 0
  const offered = isOfferedInCycle(course)
  const visibleInFilters = isVisibleInFilters(course)

  const tabs: { id: CourseDetailTab; label: string; show?: boolean }[] = [
    { id: 'general', label: 'General' },
    { id: 'common', label: 'Asignaturas comunes' },
    { id: 'orientations', label: 'Orientaciones', show: hasOrientations || course.level === 'EMS' },
    { id: 'offer', label: 'Oferta en ciclo' },
  ]

  async function createSubject(draft: SubjectDraft, opts: { common: boolean; orientationId?: string }) {
    await api(withSchoolYear(`/courses/${course.id}/subjects`), {
      method: 'POST',
      body: JSON.stringify({
        name: draft.name.trim(),
        code: draft.code.trim() || undefined,
        description: draft.description.trim() || undefined,
        sortOrder: Number(draft.sortOrder) || 0,
        isActive: draft.isActive,
        associationType: opts.common ? 'CURSO_COMPLETO' : 'ORIENTACION',
        orientationId: opts.orientationId,
      }),
    })
    await onReloadSubjects()
    onMessage(opts.common ? 'Asignatura común agregada.' : 'Asignatura de orientación agregada.')
  }

  async function updateSubject(id: string, draft: SubjectDraft) {
    await api(withSchoolYear(`/courses/${course.id}/subjects/${id}`), {
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
    if (!confirm('¿Eliminar esta asignatura?')) return
    await api(withSchoolYear(`/courses/${course.id}/subjects/${id}`), { method: 'DELETE' })
    await onReloadSubjects()
    onMessage('Asignatura eliminada.')
  }

  async function saveGeneral() {
    if (!courseEdit.name.trim()) return
    setSavingCourse(true)
    try {
      const updated = await api<CourseRow>(withSchoolYear(`/courses/${course.id}`), {
        method: 'PUT',
        body: JSON.stringify({
          name: courseEdit.name.trim(),
          code: courseEdit.code.trim() || null,
          level: courseEdit.level,
          sortOrder: Number(courseEdit.sortOrder) || 0,
          description: courseEdit.description.trim() || null,
          isActive: courseEdit.isActive,
          offeringIsActive: courseEdit.offeringIsActive,
          offeringNotes: courseEdit.offeringNotes.trim() || null,
        }),
      })
      onCourseUpdated(updated)
      onMessage('Curso actualizado.')
    } catch (e: unknown) {
      onMessage((e as Error)?.message || 'Error al actualizar curso.')
    } finally {
      setSavingCourse(false)
    }
  }

  async function attachOrientation() {
    if (!attachOrientationId) return
    await api(withSchoolYear(`/courses/${course.id}/orientations`), {
      method: 'POST',
      body: JSON.stringify({ orientationId: attachOrientationId, isActive: true }),
    })
    setAttachOrientationId('')
    await onReloadOrientations()
    onMessage('Orientación asociada al curso.')
  }

  async function createOrientation() {
    if (!orientationDraft.name.trim()) return
    const created = await api<OrientationRow>('/courses/orientations', {
      method: 'POST',
      body: JSON.stringify({
        name: orientationDraft.name.trim(),
        code: orientationDraft.code.trim() || undefined,
        description: orientationDraft.description.trim() || undefined,
        sortOrder: Number(orientationDraft.sortOrder) || 0,
        isActive: orientationDraft.isActive,
      }),
    })
    await api(withSchoolYear(`/courses/${course.id}/orientations`), {
      method: 'POST',
      body: JSON.stringify({ orientationId: created.id, isActive: true }),
    })
    setOrientationDraft(emptyOrientationDraft())
    await onReloadOrientations()
    onMessage('Orientación creada y asociada.')
  }

  async function toggleOrientationOffer(row: CourseOrientationRow) {
    await api(withSchoolYear(`/courses/${course.id}/orientations`), {
      method: 'POST',
      body: JSON.stringify({ orientationId: row.orientationId, isActive: !row.isActive }),
    })
    await onReloadOrientations()
    onMessage(row.isActive ? 'Orientación desactivada en el ciclo.' : 'Orientación activada en el ciclo.')
  }

  const unattachedOrientations = orientationsCatalog.filter(
    (o) => !courseOrientations.some((co) => co.orientationId === o.id),
  )

  return (
    <div className="flex min-h-[560px] flex-col">
      <header className="border-b border-gray-200 bg-slate-50/80 px-4 py-4">
        <h2 className="text-xl font-bold text-gray-900">Curso: {courseShortLabel(course.name)}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-600">
          <span>Nivel: {course.level ?? '—'}</span>
          {course.code ? <span>· Código: {course.code}</span> : null}
          <span>· Ciclo: {schoolYearLabel}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <CatalogStatusChip active={course.isActive} />
          <OfferingStatusChip offered={offered} hasOffering={Boolean(course.courseOfferingId)} />
          <FilterVisibilityChip visible={visibleInFilters} />
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200 bg-white px-2 pt-2">
        {tabs
          .filter((t) => t.show !== false)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? 'border border-b-white border-gray-200 bg-white text-emerald-800'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'general' && (
          <div className="max-w-xl space-y-3">
            <p className="text-sm text-gray-600">Datos del catálogo del curso (permanentes entre ciclos).</p>
            <label className="block text-xs">
              <span className="text-gray-600">Nombre</span>
              <input
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={courseEdit.name}
                onChange={(e) => setCourseEdit({ ...courseEdit, name: e.target.value })}
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="text-gray-600">Nivel</span>
                <select
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  value={courseEdit.level}
                  onChange={(e) => setCourseEdit({ ...courseEdit, level: e.target.value as 'EBI' | 'EMS' })}
                >
                  <option value="EBI">EBI</option>
                  <option value="EMS">EMS</option>
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-gray-600">Código</span>
                <input
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  value={courseEdit.code}
                  onChange={(e) => setCourseEdit({ ...courseEdit, code: e.target.value })}
                />
              </label>
              <label className="block text-xs">
                <span className="text-gray-600">Orden</span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  value={courseEdit.sortOrder}
                  onChange={(e) => setCourseEdit({ ...courseEdit, sortOrder: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="block text-xs">
              <span className="text-gray-600">Descripción</span>
              <textarea
                rows={3}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={courseEdit.description}
                onChange={(e) => setCourseEdit({ ...courseEdit, description: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={courseEdit.isActive}
                onChange={(e) => setCourseEdit({ ...courseEdit, isActive: e.target.checked })}
              />
              Activo en catálogo
            </label>
            <button
              type="button"
              disabled={savingCourse}
              onClick={() => void saveGeneral()}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {savingCourse ? <Loader2 className="inline h-4 w-4 animate-spin" aria-hidden /> : null}
              Guardar datos del curso
            </button>
          </div>
        )}

        {tab === 'common' && (
          <SubjectListBlock
            title="Asignaturas comunes del curso"
            hint="Aplican al curso completo. Si hay orientaciones, también valen para todas ellas (no hace falta repetirlas en cada orientación)."
            subjects={common}
            loading={subjectsLoading}
            addLabel="Agregar asignatura común"
            onCreate={(d) => createSubject(d, { common: true })}
            onUpdate={updateSubject}
            onRemove={removeSubject}
          />
        )}

        {tab === 'orientations' && (
          <div className="space-y-4">
            {!hasOrientations ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
                Este curso no tiene orientaciones. Podés usar solo asignaturas comunes en la pestaña anterior, o
                asociar una orientación abajo.
              </div>
            ) : (
              <div className="space-y-3">
                {courseOrientations.map((row) => {
                  const open = expanded[row.id] ?? true
                  const specific = byOrientation.get(row.orientationId) ?? []
                  return (
                    <div key={row.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100"
                        onClick={() => setExpanded((c) => ({ ...c, [row.id]: !open }))}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {open ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                          )}
                          <span className="font-semibold text-gray-900">{row.orientation.name}</span>
                        </span>
                        <span className="flex flex-wrap justify-end gap-1">
                          <CatalogStatusChip active={row.orientation.isActive} />
                          <OfferingStatusChip offered={row.isActive} hasOffering={Boolean(row.schoolYearId ?? course.courseOfferingId)} />
                        </span>
                      </button>
                      {open && (
                        <div className="space-y-4 border-t border-gray-100 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={row.isActive}
                              className={`relative h-6 w-11 rounded-full transition ${row.isActive ? 'bg-emerald-600' : 'bg-gray-300'}`}
                              onClick={() => void toggleOrientationOffer(row)}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                                  row.isActive ? 'left-5' : 'left-0.5'
                                }`}
                              />
                              <span className="sr-only">Oferta de orientación en ciclo</span>
                            </button>
                            <span className="text-xs text-gray-500">
                              {row.isActive ? 'Ofertada en ciclo' : 'No ofertada en ciclo'}
                            </span>
                          </div>

                          {common.length > 0 ? (
                            <div className="rounded-md border border-sky-100 bg-sky-50/50 p-3">
                              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-900">
                                Asignaturas comunes heredadas
                              </div>
                              <ul className="space-y-1 text-sm text-gray-800">
                                {common.map((s) => (
                                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                                    <span>{s.name}</span>
                                    <SubjectStatusChip active={s.isActive} assignmentActive={s.assignmentIsActive} />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <SubjectListBlock
                            title="Asignaturas específicas de esta orientación"
                            hint="Solo para estudiantes de esta orientación."
                            subjects={specific}
                            loading={subjectsLoading}
                            addLabel="Agregar asignatura específica"
                            onCreate={(d) => createSubject(d, { common: false, orientationId: row.orientationId })}
                            onUpdate={updateSubject}
                            onRemove={removeSubject}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-4">
              <h4 className="text-sm font-semibold text-gray-900">Asociar orientación al curso</h4>
              <p className="mt-1 text-xs text-gray-600">
                Elegí una orientación del catálogo global o creá una nueva y asociala a este curso.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  className="min-w-[12rem] flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                  value={attachOrientationId}
                  onChange={(e) => setAttachOrientationId(e.target.value)}
                >
                  <option value="">Orientación existente…</option>
                  {unattachedOrientations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!attachOrientationId}
                  onClick={() => void attachOrientation()}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  Asociar
                </button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <input
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm sm:col-span-2"
                  placeholder="Nueva orientación"
                  value={orientationDraft.name}
                  onChange={(e) => setOrientationDraft({ ...orientationDraft, name: e.target.value })}
                />
                <input
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                  placeholder="Código opcional"
                  value={orientationDraft.code}
                  onChange={(e) => setOrientationDraft({ ...orientationDraft, code: e.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                  value={orientationDraft.sortOrder}
                  onChange={(e) => setOrientationDraft({ ...orientationDraft, sortOrder: Number(e.target.value) })}
                />
              </div>
              <button
                type="button"
                onClick={() => void createOrientation()}
                className="mt-3 inline-flex items-center gap-1 rounded bg-white px-3 py-1.5 text-sm text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Crear y asociar orientación
              </button>
            </div>
          </div>
        )}

        {tab === 'offer' && (
          <div className="max-w-xl space-y-4">
            <p className="text-sm text-gray-600">
              Configuración de la oferta en el ciclo lectivo seleccionado. Los filtros operativos de la app usan
              cursos y orientaciones ofertados y activos.
            </p>
            <div className="flex flex-wrap gap-2">
              <OfferingStatusChip offered={offered} hasOffering={Boolean(course.courseOfferingId)} />
              <FilterVisibilityChip visible={visibleInFilters} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={courseEdit.offeringIsActive}
                onChange={(e) => setCourseEdit({ ...courseEdit, offeringIsActive: e.target.checked })}
                disabled={!course.courseOfferingId}
              />
              Ofertado y activo en el ciclo actual
            </label>
            {!course.courseOfferingId ? (
              <p className="text-xs text-amber-800">
                Este curso no está ofertado en el ciclo. Activá la oferta desde la lista de cursos o creá el curso
                marcando “Ofertar en ciclo”.
              </p>
            ) : null}
            <label className="block text-xs">
              <span className="text-gray-600">Observaciones de la oferta</span>
              <textarea
                rows={3}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                value={courseEdit.offeringNotes}
                onChange={(e) => setCourseEdit({ ...courseEdit, offeringNotes: e.target.value })}
              />
            </label>
            <button
              type="button"
              disabled={savingCourse}
              onClick={() => void saveGeneral()}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Guardar oferta en ciclo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
