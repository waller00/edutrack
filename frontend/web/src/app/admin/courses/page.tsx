'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import SubjectListBlock from '@/components/admin/courses/SubjectListBlock'
import type {
  CourseOrientationRow,
  CourseRow,
  OrientationRow,
  SubjectDraft,
  SubjectRow,
} from '@/components/admin/courses/course-types'
import { courseShortLabel, partitionSubjects } from '@/components/admin/courses/course-types'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { BookOpen, ChevronDown, ChevronRight, Layers, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

type CourseDraft = {
  name: string
  code: string
  level: 'EBI' | 'EMS'
  sortOrder: number
  description: string
  isActive: boolean
  offerInSchoolYear: boolean
}

function emptyCourseDraft(): CourseDraft {
  return { name: '', code: '', level: 'EBI', sortOrder: 0, description: '', isActive: true, offerInSchoolYear: true }
}

export default function AdminCoursesPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const activeSchoolYearId = syCtx?.allYears ? null : syCtx?.selectedId ?? syCtx?.activeId ?? null
  const schoolYearLabel = useMemo(() => {
    if (syCtx?.allYears) return 'Todos los ciclos'
    const id = syCtx?.selectedId ?? syCtx?.activeId
    const y = syCtx?.years.find((row) => row.id === id)
    return y ? `${y.code} — ${y.label}` : 'Ciclo activo'
  }, [syCtx])

  const [courses, setCourses] = useState<CourseRow[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(emptyCourseDraft())
  const [creatingCourse, setCreatingCourse] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [orientations, setOrientations] = useState<OrientationRow[]>([])
  const [courseOrientations, setCourseOrientations] = useState<CourseOrientationRow[]>([])
  const [showCreateCourse, setShowCreateCourse] = useState(false)
  const [showHistoricalSubjects, setShowHistoricalSubjects] = useState(false)
  const [orientationsOpen, setOrientationsOpen] = useState(false)
  const [selectedCourseOrientationId, setSelectedCourseOrientationId] = useState<string | null>(null)
  const [attachOrientationId, setAttachOrientationId] = useState('')
  const [newOrientationName, setNewOrientationName] = useState('')
  const [editingOrientationId, setEditingOrientationId] = useState<string | null>(null)
  const [editingOrientationName, setEditingOrientationName] = useState('')

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true)
    setMsg('')
    try {
      const list = await api<CourseRow[]>(
        withSchoolYear('/courses?all=1&includeNotOffered=1', schoolYearQuery),
      )
      setCourses(Array.isArray(list) ? list : [])
    } catch {
      setCourses([])
      setMsg('No se pudieron cargar los cursos.')
    } finally {
      setCoursesLoading(false)
    }
  }, [schoolYearQuery])

  const loadOrientations = useCallback(async () => {
    try {
      const list = await api<OrientationRow[]>('/courses/orientations?all=1')
      setOrientations(Array.isArray(list) ? list : [])
    } catch {
      setOrientations([])
    }
  }, [])

  const loadCourseOrientations = useCallback(
    async (courseId: string) => {
      try {
        const list = await api<CourseOrientationRow[]>(
          withSchoolYear(`/courses/${courseId}/orientations?all=1`, schoolYearQuery),
        )
        setCourseOrientations(Array.isArray(list) ? list : [])
      } catch {
        setCourseOrientations([])
      }
    },
    [schoolYearQuery],
  )

  const loadSubjects = useCallback(
    async (courseId: string) => {
      setSubjectsLoading(true)
      try {
        const list = await api<SubjectRow[]>(
          withSchoolYear(`/courses/${courseId}/subjects?all=1&includeNotOffered=1`, schoolYearQuery),
        )
        setSubjects(Array.isArray(list) ? list : [])
      } catch {
        setSubjects([])
        setMsg('No se pudieron cargar las asignaturas.')
      } finally {
        setSubjectsLoading(false)
      }
    },
    [schoolYearQuery],
  )

  useEffect(() => {
    void loadCourses()
    void loadOrientations()
  }, [loadCourses, loadOrientations])

  useEffect(() => {
    if (!selectedCourseId) {
      setSubjects([])
      setCourseOrientations([])
      return
    }
    setOrientationsOpen(true)
    setSelectedCourseOrientationId(null)
    setAttachOrientationId('')
    setNewOrientationName('')
    setEditingOrientationId(null)
    setEditingOrientationName('')
    void loadSubjects(selectedCourseId)
    void loadCourseOrientations(selectedCourseId)
  }, [selectedCourseId, loadSubjects, loadCourseOrientations])

  const visibleCourses = useMemo(
    () =>
      [...courses].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'es'),
      ),
    [courses],
  )
  const selectedCourse = courses.find((c) => c.id === selectedCourseId)
  const selectedCourseOrientation =
    courseOrientations.find((row) => row.id === selectedCourseOrientationId) ?? null
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
  const selectedSpecificSubjects = selectedCourseOrientation
    ? byOrientation.get(selectedCourseOrientation.orientationId) ?? []
    : []
  const unattachedOrientations = useMemo(
    () => orientations.filter((o) => !courseOrientations.some((co) => co.orientationId === o.id)),
    [orientations, courseOrientations],
  )

  const ws = (path: string) => withSchoolYear(path, schoolYearQuery)
  const adminPath = (path: string) => {
    const separator = path.includes('?') ? '&' : '?'
    return ws(`${path}${separator}all=1&includeNotOffered=1`)
  }

  async function createCourse() {
    if (!courseDraft.name.trim()) {
      setMsg('Escribí el nombre del curso.')
      return
    }
    if (courseDraft.offerInSchoolYear && !activeSchoolYearId) {
      setMsg('Elegí un ciclo lectivo concreto para ofertar el curso.')
      return
    }
    setCreatingCourse(true)
    setMsg('')
    try {
      const created = await api<CourseRow>('/courses', {
        method: 'POST',
        body: JSON.stringify({
          name: courseDraft.name.trim(),
          code: courseDraft.code.trim() || undefined,
          sortOrder: Number(courseDraft.sortOrder) || 0,
          description: courseDraft.description.trim() || undefined,
          isActive: courseDraft.isActive,
          offerInSchoolYear: courseDraft.offerInSchoolYear,
          schoolYearId: courseDraft.offerInSchoolYear ? activeSchoolYearId : undefined,
        }),
      })
      setCourseDraft(emptyCourseDraft())
      setShowCreateCourse(false)
      await loadCourses()
      setSelectedCourseId(created.id)
      setMsg(courseDraft.offerInSchoolYear ? 'Curso creado y ofertado en el ciclo.' : 'Curso creado en el catálogo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al crear curso.')
    } finally {
      setCreatingCourse(false)
    }
  }

  async function toggleCourseOffering(course: CourseRow) {
    if (!activeSchoolYearId) {
      setMsg('Elegí un ciclo lectivo concreto para activar o desactivar la oferta.')
      return
    }
    const offered = Boolean(
      course.courseOfferingId && (course.offeringIsActive ?? false) && (course.offeringIsOffered ?? true),
    )
    setMsg('')
    try {
      const updated = await api<CourseRow>(ws(`/courses/${course.id}`), {
        method: 'PUT',
        body: JSON.stringify({ offeringIsActive: !offered }),
      })
      setCourses((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
      setMsg(!offered ? 'Curso activado en el ciclo.' : 'Curso desactivado en el ciclo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la oferta del curso.')
    }
  }

  async function createSubject(draft: SubjectDraft, opts: { common: boolean; orientationId?: string }) {
    if (!selectedCourse) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/subjects`), {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          sortOrder: Number(draft.sortOrder) || 0,
          isActive: true,
          associationType: opts.common ? (selectedCourse.level === 'EMS' ? 'TRONCO_COMUN_CURSO' : 'CURSO_COMPLETO') : 'ORIENTACION',
          orientationId: opts.orientationId,
        }),
      })
      await loadSubjects(selectedCourse.id)
      onMessage(opts.common ? 'Asignatura común agregada.' : 'Asignatura específica agregada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo agregar la asignatura.')
      throw e
    }
  }

  async function updateSubject(id: string, draft: SubjectDraft) {
    if (!selectedCourse) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/subjects/${id}`), {
        method: 'PUT',
        body: JSON.stringify({
          name: draft.name.trim(),
          code: draft.code.trim() || null,
          description: draft.description.trim() || null,
          sortOrder: Number(draft.sortOrder) || 0,
          isActive: draft.isActive,
        }),
      })
      await loadSubjects(selectedCourse.id)
      onMessage('Asignatura actualizada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la asignatura.')
      throw e
    }
  }

  async function removeSubject(id: string) {
    if (!selectedCourse) return
    if (!confirm('¿Eliminar esta asignatura del plan?')) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/subjects/${id}`), { method: 'DELETE' })
      await loadSubjects(selectedCourse.id)
      onMessage('Asignatura quitada del plan.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo quitar la asignatura.')
    }
  }

  async function attachOrientation() {
    if (!selectedCourse || !attachOrientationId) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/orientations`), {
        method: 'POST',
        body: JSON.stringify({ orientationId: attachOrientationId, isActive: true }),
      })
      setAttachOrientationId('')
      await loadCourseOrientations(selectedCourse.id)
      onMessage('Orientación agregada al curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo agregar la orientación.')
    }
  }

  async function createOrientation() {
    if (!selectedCourse || !newOrientationName.trim()) return
    setMsg('')
    try {
      const created = await api<OrientationRow>('/courses/orientations', {
        method: 'POST',
        body: JSON.stringify({ name: newOrientationName.trim(), isActive: true }),
      })
      await api(adminPath(`/courses/${selectedCourse.id}/orientations`), {
        method: 'POST',
        body: JSON.stringify({ orientationId: created.id, isActive: true }),
      })
      setNewOrientationName('')
      await loadOrientations()
      await loadCourseOrientations(selectedCourse.id)
      onMessage('Orientación creada y agregada al curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo crear la orientación.')
    }
  }

  async function updateOrientation(row: CourseOrientationRow) {
    if (!selectedCourse || !editingOrientationName.trim()) return
    setMsg('')
    try {
      await api<OrientationRow>(`/courses/orientations/${row.orientationId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editingOrientationName.trim() }),
      })
      setEditingOrientationId(null)
      setEditingOrientationName('')
      await loadOrientations()
      await loadCourseOrientations(selectedCourse.id)
      onMessage('Orientación actualizada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la orientación.')
    }
  }

  async function toggleOrientationOffer(row: CourseOrientationRow) {
    if (!selectedCourse) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/orientations`), {
        method: 'POST',
        body: JSON.stringify({ orientationId: row.orientationId, isActive: !row.isActive }),
      })
      await loadCourseOrientations(selectedCourse.id)
      await loadSubjects(selectedCourse.id)
      onMessage(!row.isActive ? 'Orientación activada en el curso.' : 'Orientación desactivada en el curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la orientación.')
    }
  }

  async function removeOrientationFromCourse(row: CourseOrientationRow) {
    if (!selectedCourse) return
    if (!confirm(`¿Quitar "${row.orientation.name}" de ${courseShortLabel(selectedCourse.name)}?`)) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/orientations/${row.id}`), { method: 'DELETE' })
      await loadCourseOrientations(selectedCourse.id)
      await loadSubjects(selectedCourse.id)
      onMessage('Orientación quitada del curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo quitar la orientación.')
    }
  }

  async function deleteOrientation(row: CourseOrientationRow) {
    if (!selectedCourse) return
    if (!confirm(`¿Eliminar "${row.orientation.name}" del catálogo? También se ocultará de los cursos donde esté asociada.`)) return
    setMsg('')
    try {
      await api(`/courses/orientations/${row.orientationId}`, { method: 'DELETE' })
      await loadOrientations()
      await loadCourseOrientations(selectedCourse.id)
      await loadSubjects(selectedCourse.id)
      onMessage('Orientación eliminada del catálogo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo eliminar la orientación.')
    }
  }

  function onMessage(message: string) {
    setMsg(message)
  }

  return (
    <RoleGuard permission="courses.manage">
      <main className="responsive-page max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <BookOpen className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Cursos y asignaturas</h1>
            <p className="text-gray-600">
              Catálogo académico completo. La oferta del ciclo solo afecta filtros operativos y creación de eventos.
            </p>
          </div>
        </div>

        {msg ? (
          <div className="rounded border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800">{msg}</div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(320px,520px)_minmax(0,1fr)]">
          <aside className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900">Cursos del catálogo</h2>
                <Layers className="h-4 w-4 text-emerald-600" aria-hidden />
              </div>
              <p className="mt-1 text-xs text-gray-500">Orden académico · Ciclo: {schoolYearLabel}</p>
              <button
                type="button"
                onClick={() => setShowCreateCourse((v) => !v)}
                className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {showCreateCourse ? 'Ocultar formulario' : 'Nuevo curso'}
              </button>
            </div>

            {showCreateCourse ? (
              <div className="border-b border-gray-100 bg-emerald-50/30 p-3">
                <div className="grid gap-2">
                  <input
                    className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    placeholder="Nombre del curso"
                    value={courseDraft.name}
                    onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })}
                  />
                  <input
                    type="number"
                    className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    placeholder="Orden"
                    value={courseDraft.sortOrder}
                    onChange={(e) => setCourseDraft({ ...courseDraft, sortOrder: Number(e.target.value) })}
                  />
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={courseDraft.offerInSchoolYear}
                      onChange={(e) => setCourseDraft({ ...courseDraft, offerInSchoolYear: e.target.checked })}
                    />
                    Ofertar en ciclo actual
                  </label>
                  <button
                    type="button"
                    disabled={creatingCourse}
                    onClick={() => void createCourse()}
                    className="rounded bg-emerald-600 px-2 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Crear curso
                  </button>
                </div>
              </div>
            ) : null}

            {coursesLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Cargando…
              </div>
            ) : visibleCourses.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No hay cursos en el catálogo.</p>
            ) : (
              <div className="max-h-[min(70vh,640px)] overflow-y-auto p-2">
                <ul className="space-y-1">
                  {visibleCourses.map((c) => {
                    const offered = Boolean(
                      c.courseOfferingId && (c.offeringIsActive ?? false) && (c.offeringIsOffered ?? true),
                    )
                    return (
                      <li key={c.id}>
                        <div
                          className={`flex items-center gap-2 rounded-md border px-2 py-2 text-sm ${
                            selectedCourseId === c.id
                              ? 'border-emerald-500 bg-emerald-50'
                              : !c.isActive || !offered
                                ? 'border-transparent bg-gray-50/80 opacity-80'
                                : 'border-transparent hover:bg-gray-50'
                          }`}
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              setSelectedCourseId(c.id)
                              setSelectedCourseOrientationId(null)
                            }}
                          >
                            <div className="font-medium text-gray-900">{c.name}</div>
                            <div className="mt-0.5 text-[11px] text-gray-500">
                              {!c.courseOfferingId ? 'No ofertado' : offered ? 'Ofertado' : 'No ofertado'}
                              {!c.isActive ? ' · Catálogo inactivo' : ''}
                            </div>
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={offered}
                            title={offered ? 'Desactivar en el ciclo' : 'Activar en el ciclo'}
                            onClick={() => void toggleCourseOffering(c)}
                            className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                              offered ? 'bg-emerald-600' : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                                offered ? 'left-4' : 'left-0.5'
                              }`}
                            />
                            <span className="sr-only">{offered ? 'Desactivar curso' : 'Activar curso'}</span>
                          </button>
                        </div>
                        {selectedCourseId === c.id && selectedCourse ? (
                          <div className="mt-1 rounded-md border border-emerald-100 bg-white p-2">
                            <div className="rounded-md border border-gray-200 bg-white">
                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left hover:bg-gray-50"
                                onClick={() => setOrientationsOpen((value) => !value)}
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  {orientationsOpen ? (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                                  )}
                                  <span className="truncate text-sm font-semibold text-gray-900">Orientaciones</span>
                                </span>
                                <span className="shrink-0 text-[11px] text-gray-500">
                                  {courseOrientations.length}
                                </span>
                              </button>

                              {orientationsOpen ? (
                                <div className="space-y-2 border-t border-gray-100 p-2">
                                  {courseOrientations.length === 0 ? (
                                    <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-500">
                                      Este curso no tiene orientaciones.
                                    </div>
                                  ) : (
                                    courseOrientations.map((row) => {
                                      const specific = byOrientation.get(row.orientationId) ?? []
                                      const isEditing = editingOrientationId === row.id
                                      const selected = selectedCourseOrientationId === row.id
                                      return (
                                        <div
                                          key={row.id}
                                          className={`rounded-md border bg-white ${
                                            selected ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200'
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-2 px-2 py-2 hover:bg-gray-50">
                                            <button
                                              type="button"
                                              className="shrink-0"
                                              onClick={() => setSelectedCourseOrientationId(row.id)}
                                            >
                                              <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden />
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
                                                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-900"
                                                onClick={() => setSelectedCourseOrientationId(row.id)}
                                              >
                                                {row.orientation.name}
                                              </button>
                                            )}
                                            <span className="hidden shrink-0 text-[11px] text-gray-500 xl:inline">
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
                                              <div className="flex shrink-0 items-center gap-0.5">
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
                                        </div>
                                      )
                                    })
                                  )}

                                  <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-2">
                                    <div className="flex flex-wrap gap-2">
                                      <select
                                        className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm sm:min-w-[12rem]"
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
                                        className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm sm:min-w-[12rem]"
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
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </aside>

          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {!selectedCourse ? (
              <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center text-gray-500">
                <Pencil className="mb-3 h-10 w-10 text-gray-300" aria-hidden />
                <p className="text-sm">Seleccioná un curso en la lista.</p>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      {selectedCourseOrientation?.orientation.name ?? courseShortLabel(selectedCourse.name)}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {selectedCourseOrientation
                        ? `Asignaturas de ${selectedCourseOrientation.orientation.name}`
                        : `Comunes de ${courseShortLabel(selectedCourse.name)}`}
                    </p>
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

                {selectedCourseOrientation ? (
                  <div className="space-y-4">
                    <div className="rounded-md bg-sky-50 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase text-sky-900">
                        Comunes heredadas de {courseShortLabel(selectedCourse.name)}
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
                      subjects={selectedSpecificSubjects}
                      loading={subjectsLoading}
                      addLabel="Agregar específica"
                      onCreate={(d) =>
                        createSubject(d, { common: false, orientationId: selectedCourseOrientation.orientationId })
                      }
                      onUpdate={updateSubject}
                      onRemove={removeSubject}
                      showStatus={showHistoricalSubjects}
                    />
                  </div>
                ) : (
                  <SubjectListBlock
                    title="Comunes"
                    subjects={common}
                    loading={subjectsLoading}
                    addLabel="Agregar común"
                    onCreate={(d) => createSubject(d, { common: true })}
                    onUpdate={updateSubject}
                    onRemove={removeSubject}
                    showStatus={showHistoricalSubjects}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </RoleGuard>
  )
}
